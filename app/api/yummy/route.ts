import { NextRequest, NextResponse } from "next/server";

const API="https://api.yani.tv";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const clean=(v:unknown)=>typeof v==="string"?v.trim():"";
function rot13(s:string){return s.replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<"n"?13:-13)))}
function decodeSrc(src:string){try{return Buffer.from(rot13(src),"base64").toString("latin1")}catch{return src}}

async function resolveAksor(rawIframeUrl:string){
 const iframeUrl=rawIframeUrl.startsWith("//")?"https:"+rawIframeUrl:rawIframeUrl;
 let parsed:URL;
 try{parsed=new URL(iframeUrl)}catch{throw new Error("Aksor вернул некорректный URL")}

 const response=await fetch(parsed.toString(),{
   headers:{
     "User-Agent":UA,
     "Referer":"https://animego.org",
     "Accept":"text/html,*/*",
     "Accept-Language":"ru-RU,ru;q=0.9"
   },
   cache:"no-store"
 });
 const html=await response.text();
 if(!response.ok)throw new Error(`Aksor: HTTP ${response.status}`);

 // Aksor embeds the actual media URL in: var videoUrl = "..."
 const match=html.match(/var\s+videoUrl\s*=\s*["\']([^"\']+)["\']/i);
 if(!match?.[1])throw new Error("Aksor: videoUrl не найден на странице плеера");

 const url=match[1].replaceAll("\\u0026","&");
 if(!url.startsWith("http://")&&!url.startsWith("https://"))throw new Error("Aksor: найден некорректный videoUrl");

 const fileMatch=url.match(/\/(\d+)\.(?:mp4|m3u8)(?:$|[?#])/i);
 const quality=fileMatch?.[1]||"auto";
 return [{quality,url}];
}

async function resolveKodik(rawIframeUrl:string){
 const iframeUrl=rawIframeUrl.startsWith("//")?"https:"+rawIframeUrl:rawIframeUrl;
 let parsed:URL;
 try{parsed=new URL(iframeUrl)}catch{throw new Error("Kodik вернул некорректный URL источника")}

 const parts=parsed.pathname.split("/").filter(Boolean);
 if(parts.length<4)throw new Error("Kodik: не удалось разобрать ссылку серии");
 const type=parts[0], id=parts[1], hash=parts[2];
 if(!/^\\d+$/.test(id)||!/^[0-9a-z]+$/i.test(hash))throw new Error("Kodik: некорректные id/hash серии");

 const params=new URLSearchParams({type,id,hash});
 const page=await fetch(parsed.toString(),{headers:{"User-Agent":UA,"Accept":"text/html,*/*","Referer":"https://yummyani.me/"},cache:"no-store"});
 const html=await page.text();

 let endpoint="/kor";
 const playerMatch=html.match(/<script[^>]+src=["']([^"']*player_single[^"']*\\.js)["']/i);
 if(playerMatch?.[1]){
   try{
     const playerUrl=new URL(playerMatch[1],parsed.origin);
     const js=await (await fetch(playerUrl.toString(),{headers:{"User-Agent":UA,"Referer":iframeUrl},cache:"no-store"})).text();
     const b64=js.match(/type:"POST",url:atob\\("([^"]+)"\\)/i)?.[1];
     if(b64){
       const discovered=Buffer.from(b64,"base64").toString("utf8").trim();
       if(discovered)endpoint=discovered;
     }
   }catch{}
 }

 const endpointUrl=new URL(endpoint,parsed.origin);
 const response=await fetch(endpointUrl.toString()+"?"+params.toString(),{
   method:"GET",
   headers:{"User-Agent":UA,"Referer":iframeUrl,"Accept":"application/json,text/plain,*/*"},
   cache:"no-store"
 });
 const body=await response.text();
 if(!response.ok)throw new Error(`Kodik resolver: HTTP ${response.status} (${endpointUrl.pathname})`);
 if(/^\\s*</.test(body))throw new Error(`Kodik resolver вернул HTML вместо JSON (${endpointUrl.pathname})`);
 let json:any;try{json=JSON.parse(body)}catch{throw new Error(`Kodik resolver вернул некорректный JSON (${endpointUrl.pathname})`)}

 const out:{quality:string,url:string}[]=[];
 for(const [q,arr] of Object.entries(json?.links||{})){
   const item:any=Array.isArray(arr)?arr[0]:null;
   if(!item?.src)continue;
   const decryptedBase64=String(item.src).replace(/[a-zA-Z]/g,(ch)=>{
     let n=ch.charCodeAt(0)+18; const max=ch<="Z"?90:122;
     if(n>max)n-=26; return String.fromCharCode(n);
   });
   try{
     const url=Buffer.from(decryptedBase64,"base64").toString("utf8");
     if(/^https?:\\/\\//i.test(url))out.push({quality:q,url});
   }catch{}
 }
 if(!out.length)throw new Error("Kodik: resolver не вернул видеопоток");
 return out;
}

async function resolvePlayer(rawIframeUrl:string){
 const iframe=rawIframeUrl.startsWith("//")?"https:"+rawIframeUrl:rawIframeUrl;
 let host="";
 try{host=new URL(iframe).hostname.toLowerCase()}catch{throw new Error("Плеер вернул некорректную ссылку")}
 if(host==="aksor.yani.tv"||host.endsWith(".aksor.yani.tv"))return resolveAksor(iframe);
 if(host.includes("kodik"))return resolveKodik(iframe);
 throw new Error(`Неподдерживаемый плеер: ${host}`);
}

export async function POST(req:NextRequest){
 try{
  const body=await req.json(); const token=clean(body?.token), privateToken=clean(body?.privateToken), action=body?.action;
  if(!token)return NextResponse.json({error:"Нужен Public key (X-Application)"},{status:400});
  if(action==="resolve"){
   const iframe=clean(body?.iframe); if(!iframe)return NextResponse.json({error:"Не указан iframe"},{status:400});
   try{return NextResponse.json({sources:await resolvePlayer(iframe)},{headers:{"Cache-Control":"no-store"}})}
   catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Не удалось получить видео"},{status:502})}
  }
  let path=""; const params=new URLSearchParams();
  if(action==="search"){const q=clean(body?.query);if(!q)return NextResponse.json({error:"Введите название"},{status:400});path="/search";params.set("q",q);params.set("limit","10");params.set("offset","0")}
  else if(action==="anime"){const id=String(body?.id??"").trim();if(!id)return NextResponse.json({error:"Не указан anime id"},{status:400});path="/anime/"+encodeURIComponent(id);params.set("need_videos","1")}
  else return NextResponse.json({error:"Неизвестное действие"},{status:400});
  const headers:Record<string,string>={"X-Application":token,"Accept":"application/json","Accept-Language":"ru"}; if(privateToken)headers.Authorization="Bearer "+privateToken;
  const response=await fetch(API+path+(params.size?"?"+params.toString():""),{headers,cache:"no-store"}); const text=await response.text(); let data:unknown;try{data=JSON.parse(text)}catch{data={raw:text}}
  if(!response.ok)return NextResponse.json({error:`YummyAnime API: HTTP ${response.status}`,data},{status:response.status});
  return NextResponse.json({data},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Не удалось обратиться к YummyAnime API"},{status:500})}
}