import { NextRequest, NextResponse } from "next/server";

const API="https://api.yani.tv";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const clean=(v:unknown)=>typeof v==="string"?v.trim():"";

async function resolveAksor(rawIframeUrl:string){
 const iframeUrl=rawIframeUrl.startsWith("//")?"https:"+rawIframeUrl:rawIframeUrl;
 let parsed:URL;
 try{parsed=new URL(iframeUrl)}catch{throw new Error("Aksor вернул некорректный URL")}
 const response=await fetch(parsed.toString(),{headers:{"User-Agent":UA,"Referer":"https://animego.org","Accept":"text/html,*/*","Accept-Language":"ru-RU,ru;q=0.9"},cache:"no-store"});
 const html=await response.text();
 if(!response.ok)throw new Error(`Aksor: HTTP ${response.status}`);
 const pick=(key:string)=>{
  const patterns=[key+"=",key+":","var "+key+"=","let "+key+"=","const "+key+"="];
  for(const marker of patterns){
   const p=html.indexOf(marker);if(p<0)continue;
   const tail=html.slice(p+marker.length).trim();
   const q=tail[0];
   if(q==='"'||q==="'"){const e=tail.indexOf(q,1);if(e>0)return tail.slice(1,e)}
  }
  return "";
 };
 let url=pick("videoUrl");
 if(!url){
  const m=html.match(/https?:[^"'\\s<>]+/g)||[];
  url=m.map(x=>x.replace(/\\u0026/g,"&").replace(/\\u002F/g,"/")).find(x=>/\.(m3u8|mp4)(\?|$)/i.test(x))||"";
 }
 if(!url)throw new Error("Aksor: ссылка видео не найдена");
 url=url.replaceAll("\\u0026","&").replaceAll("\\u002F","/");
 if(!url.startsWith("http://")&&!url.startsWith("https://"))throw new Error("Aksor: найден некорректный URL");
 return [{quality:"auto",url}];
}

async function resolveKodik(rawIframeUrl:string){
 const iframeUrl=rawIframeUrl.startsWith("//")?"https:"+rawIframeUrl:rawIframeUrl;
 let parsed:URL;
 try{parsed=new URL(iframeUrl)}catch{throw new Error("Kodik вернул некорректный URL")}
 const page=await fetch(parsed.toString(),{headers:{"User-Agent":UA,"Accept":"text/html,*/*","Referer":"https://yummyani.me/","Accept-Language":"ru-RU,ru;q=0.9"},cache:"no-store"});
 const html=await page.text();
 if(!page.ok)throw new Error(`Kodik page: HTTP ${page.status}`);
 const getVar=(name:string)=>{
  const m=html.match(new RegExp("vInfo\\\\."+name+"\\\\s*=\\\\s*['\\\"]([^'\\\"]+)['\\\"]"));
  return m?.[1]||"";
 };
 const urlParamsMatch=html.match(/var\\s+urlParams\\s*=\\s*['\"]([^'\"]+)['\"]/);
 let urlParams:any={};
 if(urlParamsMatch?.[1]){try{urlParams=JSON.parse(urlParamsMatch[1])}catch{}}
 const parts=parsed.pathname.split("/").filter(Boolean);
 const type=getVar("type")||parts[0]||"seria";
 const id=getVar("id")||parts[1]||"";
 const hash=getVar("hash")||parts[2]||"";
 if(!id||!hash)throw new Error("Kodik: не удалось разобрать id/hash серии");
 let endpoint="";
 const scripts=Array.from(html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)).map(m=>m[1]);
 for(const src of scripts){
  try{
   const js=await (await fetch(new URL(src,parsed.origin).toString(),{headers:{"User-Agent":UA,"Referer":iframeUrl},cache:"no-store"})).text();
   const b64=js.match(/url:atob\\(["']([^"']+)["']\\)/i)?.[1];
   if(b64){const decoded=Buffer.from(b64,"base64").toString("utf8").trim();if(decoded.startsWith("/")){endpoint=decoded;break}}
  }catch{}
 }
 if(!endpoint)endpoint="/ftor";
 const data=new URLSearchParams();
 for(const k of ["d","d_sign","pd","pd_sign","ref","ref_sign"]){if(urlParams[k]!=null)data.set(k,decodeURIComponent(String(urlParams[k])));}
 data.set("bad_user","false");data.set("cdn_is_working","true");data.set("info","{}");data.set("type",type);data.set("hash",hash);data.set("id",id);
 const endpointUrl=new URL(endpoint,parsed.origin);
 const response=await fetch(endpointUrl.toString(),{method:"POST",headers:{"User-Agent":UA,"Referer":iframeUrl,"Origin":parsed.origin,"Accept":"application/json,text/javascript,*/*","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","X-Requested-With":"XMLHttpRequest"},body:data.toString(),cache:"no-store"});
 const body=await response.text();
 if(!response.ok)throw new Error(`Kodik resolver: HTTP ${response.status} (${endpointUrl.pathname})`);
 let json:any;try{json=JSON.parse(body)}catch{throw new Error("Kodik resolver вернул некорректный JSON")};
 const out:{quality:string,url:string}[]=[];
 for(const [q,arr] of Object.entries(json?.links||{})){
  const item:any=Array.isArray(arr)?arr[0]:null;if(!item?.src)continue;
  const shifted=String(item.src).replace(/[a-zA-Z]/g,ch=>{let n=ch.charCodeAt(0)+18;const max=ch<="Z"?90:122;if(n>max)n-=26;return String.fromCharCode(n)});
  try{const url=Buffer.from(shifted,"base64").toString("utf8");if(url.startsWith("http://")||url.startsWith("https://")||url.startsWith("//"))out.push({quality:q,url:url.startsWith("//")?"https:"+url:url})}catch{}
 }
 if(!out.length)throw new Error("Kodik: resolver не вернул видеопоток");
 return out;
}

async function resolvePlayer(rawIframeUrl:string){
 const iframe=rawIframeUrl.startsWith("//")?"https:"+rawIframeUrl:rawIframeUrl;
 let host="";
 try{host=new URL(iframe).hostname.toLowerCase()}catch{throw new Error("Плеер вернул некорректную ссылку")}
 if(host.includes("aksor"))return resolveAksor(iframe);
 if(host.includes("kodik"))return resolveKodik(iframe);
 throw new Error(`Неподдерживаемый плеер: ${host}`);
}

export async function POST(req:NextRequest){
 try{
  const body=await req.json();const token=clean(body?.token),privateToken=clean(body?.privateToken),action=body?.action;
  if(!token)return NextResponse.json({error:"Нужен Public key (X-Application)"},{status:400});
  if(action==="resolve"){
   const iframe=clean(body?.iframe);if(!iframe)return NextResponse.json({error:"Не указан iframe"},{status:400});
   try{return NextResponse.json({sources:await resolvePlayer(iframe)},{headers:{"Cache-Control":"no-store"}})}
   catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Не удалось получить видео"},{status:502})}
  }
  let path="";const params=new URLSearchParams();
  if(action==="search"){const q=clean(body?.query);if(!q)return NextResponse.json({error:"Введите название"},{status:400});path="/search";params.set("q",q);params.set("limit","10");params.set("offset","0")}
  else if(action==="anime"){const id=String(body?.id??"").trim();if(!id)return NextResponse.json({error:"Не указан anime id"},{status:400});path="/anime/"+encodeURIComponent(id);params.set("need_videos","1")}
  else return NextResponse.json({error:"Неизвестное действие"},{status:400});
  const headers:Record<string,string>={"X-Application":token,"Accept":"application/json","Accept-Language":"ru"};if(privateToken)headers.Authorization="Bearer "+privateToken;
  const response=await fetch(API+path+(params.size?"?"+params.toString():""),{headers,cache:"no-store"});
  const text=await response.text();let data:unknown;try{data=JSON.parse(text)}catch{data={raw:text}}
  if(!response.ok)return NextResponse.json({error:`YummyAnime API: HTTP ${response.status}`,data},{status:response.status});
  return NextResponse.json({data},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Не удалось обратиться к YummyAnime API"},{status:500})}
}