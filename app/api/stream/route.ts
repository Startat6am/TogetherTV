import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const redis=process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN?Redis.fromEnv():null;
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";

function normalizeUrl(v:string,base:string){
  try{return new URL(v,base).toString()}catch{return ""}
}

async function getEntry(token:string){
  if(!redis){console.error("[TogetherTV stream] Redis is not configured");return null;}
  let raw:unknown;
  try{raw=await redis.get<unknown>(`togethertv:stream:${token}`)}catch(e){console.error("[TogetherTV stream] Redis read failed",e instanceof Error?e.message:"unknown");return null;}
  if(!raw){console.warn("[TogetherTV stream] Token not found");return null;}
  if(typeof raw==="object"&&raw!==null&&"url" in raw&&typeof (raw as any).url==="string")return raw as {url:string;referer:string};
  if(typeof raw==="string"){try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed.url==="string")return parsed as {url:string;referer:string}}catch{}}
  console.warn("[TogetherTV stream] Invalid token record",typeof raw);
  return null;
}

async function saveChild(url:string,referer:string){
  if(!redis)return "";
  const token=crypto.randomUUID().replace(/-/g,"");
  await redis.set(`togethertv:stream:${token}`,JSON.stringify({url,referer}),{ex:60*60*3});
  return `/api/stream?token=${token}`;
}

function rewriteManifest(text:string,base:string,referer:string){
  const lines=text.split(/\r?\n/);
  return Promise.all(lines.map(async line=>{
    const quoted=line.match(/URI="([^"]+)"/i);
    if(quoted){
      const abs=normalizeUrl(quoted[1],base);
      if(abs){
        const proxy=await saveChild(abs,referer);
        if(proxy)return line.replace(quoted[1],proxy);
      }
    }
    if(line&&!line.startsWith("#")){
      const abs=normalizeUrl(line.trim(),base);
      if(abs){
        const proxy=await saveChild(abs,referer);
        if(proxy)return proxy;
      }
    }
    return line;
  })).then(x=>x.join("\n"));
}

export async function GET(req:NextRequest){
  const token=req.nextUrl.searchParams.get("token")||"";
  if(!token)return new NextResponse("Missing token",{status:400});
  const entry=await getEntry(token);
  if(!entry?.url){console.warn("[TogetherTV stream] Stream token unavailable",JSON.stringify({tokenPresent:Boolean(token),redisConfigured:Boolean(redis)}));return new NextResponse("Stream expired",{status:404});}
  let upstream:Response;
  try{
    const headers:Record<string,string>={"User-Agent":UA,"Accept":"*/*"};
    if(entry.referer)headers.Referer=entry.referer;
    const range=req.headers.get("range");if(range)headers.Range=range;
    upstream=await fetch(entry.url,{headers,cache:"no-store"});
  }catch(e){console.error("[TogetherTV stream] Upstream fetch failed",e instanceof Error?e.message:"unknown");return new NextResponse("Upstream unavailable",{status:502})}
  if(!upstream.ok&&upstream.status!==206)return new NextResponse(`Upstream HTTP ${upstream.status}`,{status:upstream.status});
  const type=upstream.headers.get("content-type")||"";const forced=req.nextUrl.searchParams.get("type")||"";
  const isManifest=/mpegurl|\.m3u8/i.test(type)||/\.m3u8(?:$|\?)/i.test(entry.url);
  if(isManifest){
    const text=await upstream.text();
    const rewritten=await rewriteManifest(text,entry.url,entry.referer);
    return new NextResponse(rewritten,{status:200,headers:{"Content-Type":"application/vnd.apple.mpegurl","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"}});
  }
  const headers=new Headers();
  for(const name of ["content-type","content-length","content-range","accept-ranges","etag","last-modified"]){const value=upstream.headers.get(name);if(value)headers.set(name,value)}
  headers.set("Cache-Control","no-store");
  headers.set("Access-Control-Allow-Origin","*");
  return new NextResponse(upstream.body,{status:upstream.status,headers});
}
