import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const API="https://api.yani.tv";
const redis=process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN?Redis.fromEnv():null;
const STREAM_TTL=60*60*3;

async function registerStream(url:string,referer:string){
 const token=crypto.randomUUID().replace(/-/g,"");
 if(redis)await redis.set(`togethertv:stream:${token}`,JSON.stringify({url,referer}),{ex:STREAM_TTL});
 return redis?`/api/stream?token=${token}`:url;
}

async function registerSources(sources:{quality:string,url:string}[],referer:string){
 const out=[] as {quality:string,url:string}[];
 for(const source of sources){const proxy=await registerStream(source.url,referer);const kind=/\.m3u8(?:$|\?)/i.test(source.url)?"m3u8":/\.mp4(?:$|\?)/i.test(source.url)?"mp4":"media";out.push({quality:source.quality,url:proxy+(proxy.startsWith("/api/stream?")?"&type="+kind:""),kind} as any)}
 return out;
}
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";
const clean=(v:unknown)=>typeof v==="string"?v.trim():"";

function normalizeUrl(v:string){v=String(v||"").trim();if(v.startsWith("//"))return "https:"+v;if(/^https?:\/\//i.test(v))return v;return "https://"+v.replace(/^\/+/, "");}
function absoluteUrl(v:string,base:string){try{return new URL(v,base).toString()}catch{return v}}
function decodeHtmlUrl(v:string){return String(v||"").replace(/\\\//g,"/").replace(/\\u0026/gi,"&").replace(/\\u002F/gi,"/").replace(/&amp;/gi,"&").replace(/&#0*38;/gi,"&")}

async function fetchText(url:string,options:RequestInit={}){const r=await fetch(url,{...options,headers:{"User-Agent":UA,"Accept-Language":"ru-RU,ru;q=0.9,en;q=0.8",...(options.headers||{})},cache:"no-store"});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}`);return t}

function decodeKodikSrc(src:string){if(!src)return "";if(src.includes("//"))return src;try{let x=String(src).split("").map(ch=>{if(!/[a-z]/i.test(ch))return ch;let n=ch.charCodeAt(0)+18;const max=ch<="Z"?90:122;if(n>max)n-=26;return String.fromCharCode(n)}).join("");x+="=".repeat((4-x.length%4)%4);return Buffer.from(x,"base64").toString("utf8")}catch{return ""}}

async function resolveAksor(raw:string){
 const full=normalizeUrl(raw);let u:URL;try{u=new URL(full)}catch{throw new Error("Aksor: некорректная ссылка")}
 const p=u.pathname.split("/").filter(Boolean),i=p.indexOf("video"),hash=i>=0?p[i+1]:p[p.length-1];if(!hash)throw new Error("Aksor: не найден id видео");
 let payload:any;try{payload=JSON.parse(await fetchText("https://player.aksor.tv/api/video/"+encodeURIComponent(hash),{headers:{Referer:full,Accept:"application/json"}}))}catch(e){throw new Error(`Aksor API: ${e instanceof Error?e.message:"ошибка"}`)}
 const q=payload?.qualities||{},out:{quality:string,url:string}[]=[];
 for(const [quality,key] of [["360p","q360"],["480p","q480"],["720p","q720"],["1080p","q1080"],["2K","q2k"],["4K","q4k"]]){const url=decodeHtmlUrl(String(q[key]||"").trim()).replace(/ /g,"%20");if(url&&url.toLowerCase()!=="null"&&/^https?:\/\//i.test(url))out.push({quality,url})}
 if(!out.length)throw new Error("Aksor: API не вернул ссылок видео");return out
}

async function resolveKodik(raw:string){
 const full=normalizeUrl(raw);let u:URL;try{u=new URL(full)}catch{throw new Error("Kodik: некорректная ссылка")}
 const html=await fetchText(full,{headers:{Accept:"text/html,application/xhtml+xml,*/*;q=0.8",Referer:"https://yani.tv/"}}),flat=html.replace(/[\r\n]/g,"");
 const pick=(re:RegExp)=>re.exec(flat)?.[1]||"";
 const urlParamsRaw=pick(/\burlParams\s*=\s*['"]([^'"]+)['"]/),type=pick(/\b(?:videoInfo|vInfo)\.type\s*=\s*['"]([^'"]+)['"]/),hash=pick(/\b(?:videoInfo|vInfo)\.hash\s*=\s*['"]([^'"]+)['"]/),id=pick(/\b(?:videoInfo|vInfo)\.id\s*=\s*['"]([^'"]+)['"]/),playerSrc=pick(/src=["']((?:(?:https?:)?\/\/[^"']+)?\/assets\/js\/app\.player_single[^"']+)["']/i);
 if(!urlParamsRaw||!type||!hash||!id||!playerSrc)throw new Error("Kodik: не найдены параметры player");
 let up:any;try{up=JSON.parse(urlParamsRaw)}catch{throw new Error("Kodik: повреждены urlParams")}
 const scriptUrl=absoluteUrl(playerSrc,u.origin),playerOrigin=scriptUrl.split("/assets/js/")[0]||u.origin,script=await fetchText(scriptUrl,{headers:{Referer:full}});
 let endpoint="/ftor";const re=/atob\(["']([A-Za-z0-9+/=]+)["']\)/g;let m:RegExpExecArray|null;while((m=re.exec(script))){try{const d=Buffer.from(m[1],"base64").toString("utf8").trim();if(d.startsWith("/")&&d.length<=20&&!d.includes("//")){endpoint=d;break}}catch{}}
 const body=new URLSearchParams({d:String(up.d||""),d_sign:String(up.d_sign||""),pd:String(up.pd||""),pd_sign:String(up.pd_sign||""),ref:decodeURIComponent(String(up.ref||"")),ref_sign:String(up.ref_sign||""),bad_user:"true",cdn_is_working:"true",type,hash,id,info:"{}"});
 const ep=new URL(endpoint,playerOrigin),r=await fetch(ep.toString(),{method:"POST",headers:{"User-Agent":UA,"Referer":full,"Origin":playerOrigin,Accept:"application/json,text/javascript,*/*;q=0.01","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","X-Requested-With":"XMLHttpRequest"},body:body.toString(),cache:"no-store"}),txt=(await r.text()).trim();
 if(!r.ok)throw new Error(`Kodik resolver: HTTP ${r.status} (${endpoint})`);
 let json:any;try{json=JSON.parse(txt.replace(/^\uFEFF/,""))}catch{throw new Error(`Kodik resolver: сервер вернул не JSON (${txt.slice(0,80).replace(/\s+/g," ")})`)}
 const out:{quality:string,url:string}[]=[];for(const [quality,arr] of Object.entries(json?.links||{})){const item:any=Array.isArray(arr)?arr[0]:null,url=decodeKodikSrc(String(item?.src||""));if(/^https?:\/\//i.test(url))out.push({quality,url})}
 if(!out.length)throw new Error("Kodik: resolver не вернул видеопоток");return out
}

async function resolvePlayer(raw:string){const iframe=normalizeUrl(raw);let host="";try{host=new URL(iframe).hostname.toLowerCase()}catch{throw new Error("Плеер вернул некорректную ссылку")}if(host.includes("aksor"))return resolveAksor(iframe);if(host.includes("kodik"))return resolveKodik(iframe);throw new Error(`Неподдерживаемый плеер: ${host}`)}

export async function POST(req:NextRequest){
 try{const body=await req.json(),token=clean(body?.token),privateToken=clean(body?.privateToken),action=body?.action;if(!token)return NextResponse.json({error:"Нужен Public key (X-Application)"},{status:400});
 if(action==="resolve"){const iframe=clean(body?.iframe);if(!iframe)return NextResponse.json({error:"Не указан iframe"},{status:400});try{const sources=await resolvePlayer(iframe);return NextResponse.json({sources:await registerSources(sources,iframe)},{headers:{"Cache-Control":"no-store"}})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Не удалось получить видео"},{status:502})}}
 let path="",params=new URLSearchParams();if(action==="search"){const q=clean(body?.query);if(!q)return NextResponse.json({error:"Введите название"},{status:400});path="/search";params.set("q",q);params.set("limit","10");params.set("offset","0")}else if(action==="anime"){const id=String(body?.id??"").trim();if(!id)return NextResponse.json({error:"Не указан anime id"},{status:400});path="/anime/"+encodeURIComponent(id);params.set("need_videos","1")}else return NextResponse.json({error:"Неизвестное действие"},{status:400});
 const headers:Record<string,string>={"X-Application":token,Accept:"application/json","Accept-Language":"ru"};if(privateToken)headers.Authorization="Bearer "+privateToken;const r=await fetch(API+path+"?"+params.toString(),{headers,cache:"no-store"}),txt=await r.text();let data:unknown;try{data=JSON.parse(txt)}catch{data={raw:txt}}if(!r.ok)return NextResponse.json({error:`YummyAnime API: HTTP ${r.status}`,data},{status:r.status});return NextResponse.json({data},{headers:{"Cache-Control":"no-store"}})
 }catch{return NextResponse.json({error:"Не удалось обратиться к YummyAnime API"},{status:500})}
}