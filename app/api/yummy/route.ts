import { NextRequest, NextResponse } from "next/server";

const API="https://api.yani.tv";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const clean=(v:unknown)=>typeof v==="string"?v.trim():"";
function rot13(s:string){return s.replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<"n"?13:-13)))}
function decodeSrc(src:string){try{return Buffer.from(rot13(src),"base64").toString("latin1")}catch{return src}}

async function resolveKodik(rawIframeUrl:string){
 const iframeUrl=rawIframeUrl.startsWith("//")?"https:"+rawIframeUrl:rawIframeUrl;
 let parsed:URL; try{parsed=new URL(iframeUrl)}catch{throw new Error("Kodik вернул некорректный URL источника")}
 const frame=await fetch(parsed.toString(),{headers:{"User-Agent":UA,"Accept":"text/html,*/*","Referer":"https://yummyani.me/"}});
 const html=await frame.text(); const params:Record<string,string>={};
 for(const m of html.matchAll(/([a-zA-Z0-9_]+?)\s?=\s?["']([^'"]+?)["']/g))params[m[1]]=m[2];
 const hash=html.match(/videoInfo\.hash\s*=\s*["'](.+?)["']/); if(hash)params.hash=hash[1];
 if(!Object.keys(params).length)throw new Error("Не удалось получить параметры Kodik");
 params.bad_user="false"; params.d="yummyani.me";
 const origin=parsed.origin;
 const post=await fetch(origin+"/ftor",{method:"POST",headers:{"User-Agent":UA,"Referer":iframeUrl,"Origin":origin,"X-Requested-With":"XMLHttpRequest","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","Accept":"application/json,text/plain,*/*"},body:new URLSearchParams(params)});
 const postText=await post.text();
 if(!post.ok)throw new Error(`Kodik /ftor: HTTP ${post.status}`);
 if(/^\s*</.test(postText))throw new Error("Kodik /ftor вернул HTML вместо JSON — источник этой серии сейчас недоступен для автоматического извлечения");
 let json:any;try{json=JSON.parse(postText)}catch{throw new Error("Kodik /ftor вернул повреждённый JSON")}
 const out:{quality:string,url:string}[]=[];
 for(const [quality,arr] of Object.entries(json?.links||{})){const item:any=Array.isArray(arr)?arr[0]:null;if(item?.src)out.push({quality,url:decodeSrc(String(item.src))})}
 return out.filter(x=>/^https?:\/\//.test(x.url));
}

export async function POST(req:NextRequest){
 try{
  const body=await req.json(); const token=clean(body?.token), privateToken=clean(body?.privateToken), action=body?.action;
  if(!token)return NextResponse.json({error:"Нужен Public key (X-Application)"},{status:400});
  if(action==="resolve"){
   const iframe=clean(body?.iframe); if(!iframe)return NextResponse.json({error:"Не указан iframe"},{status:400});
   try{return NextResponse.json({sources:await resolveKodik(iframe)},{headers:{"Cache-Control":"no-store"}})}
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