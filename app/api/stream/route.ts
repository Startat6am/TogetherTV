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

async function saveManifestBase(url:string,referer:string){
  if(!redis)return "";
  const token=crypto.randomUUID().replace(/-/g,"");
  await redis.set(`togethertv:stream:${token}`,JSON.stringify({url,referer,manifestBase:true}),{ex:60*60*3});
  return `/api/stream/${token}/`;
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

  const range=req.headers.get("range");
  const path=req.nextUrl.searchParams.get("path");
  let upstream:Response;
  try{
    const headers:Record<string,string>={
      "User-Agent":UA,
      "Accept":"*/*",
      "Accept-Encoding":"identity",
    };
    if(entry.referer)headers.Referer=entry.referer;
    if(range)headers.Range=range;
    let upstreamUrl=entry.url;
    if(path!==null){try{upstreamUrl=new URL(path.replace(/^\/+/, ""),entry.url.endsWith("/")?entry.url:entry.url+"/").toString()}catch{}}
    upstream=await fetch(upstreamUrl,{headers,cache:"no-store",redirect:"follow"});

    // Aksor CDN may return a tiny 206/200 challenge unless the publisher Referer is used.
    const isTiny=(response:Response)=>{
      const cr=response.headers.get("content-range")||"";
      const match=/^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(cr);
      const total=match?Number(match[1]):0;
      const length=Number(response.headers.get("content-length")||0);
      return (total>0&&total<1024*1024)||(length>0&&length<1024*1024);
    };
    if(isTiny(upstream)){
      const originalReferer=entry.referer||"";
      const referers=[originalReferer,"https://old.yummyani.me/","https://yani.tv/","https://player.aksor.tv/"]
        .filter((value,index,self)=>Boolean(value)&&self.indexOf(value)===index);
      console.warn("[TogetherTV stream] Tiny CDN response; trying publisher Referer fallbacks",JSON.stringify({
        contentRange:upstream.headers.get("content-range")||null,
        contentLength:upstream.headers.get("content-length")||null,
        urlHost:new URL(entry.url).hostname,
      }));
      for(const referer of referers){
        if(referer===originalReferer)continue;
        const retryHeaders:Record<string,string>={...headers,Referer:referer};
        if(range)retryHeaders.Range=range;else delete retryHeaders.Range;
        const retry=await fetch(entry.url,{headers:retryHeaders,cache:"no-store",redirect:"follow"});
        if(retry.ok&&!isTiny(retry)){
          upstream=retry;
          console.info("[TogetherTV stream] Publisher Referer fallback succeeded",JSON.stringify({
            referer,status:retry.status,contentType:retry.headers.get("content-type")||null,
            contentLength:retry.headers.get("content-length")||null,contentRange:retry.headers.get("content-range")||null,
          }));
          break;
        }
        if(retry.ok&&isTiny(retry))await retry.body?.cancel();
      }
      if(isTiny(upstream)&&range){
        const retryHeaders:Record<string,string>={...headers};
        delete retryHeaders.Range;
        const retry=await fetch(entry.url,{headers:retryHeaders,cache:"no-store",redirect:"follow"});
        if(retry.ok&&!isTiny(retry)){
          upstream=retry;
          console.info("[TogetherTV stream] Range-less fallback succeeded",JSON.stringify({
            status:retry.status,contentType:retry.headers.get("content-type")||null,
            contentLength:retry.headers.get("content-length")||null,
          }));
        }
      }
    }
  }catch(e){
    console.error("[TogetherTV stream] Upstream fetch failed",e instanceof Error?e.message:"unknown");
    return new NextResponse("Upstream unavailable",{status:502});
  }

  if(!upstream.ok&&upstream.status!==206){
    console.warn("[TogetherTV stream] Upstream HTTP error",JSON.stringify({status:upstream.status,hasRange:Boolean(range)}));
    return new NextResponse(`Upstream HTTP ${upstream.status}`,{status:upstream.status});
  }

  const type=upstream.headers.get("content-type")||"";
  const forced=req.nextUrl.searchParams.get("type")||"";
  const isManifest=/mpegurl|\.m3u8/i.test(type)||/\.m3u8(?:$|\?)/i.test(entry.url);
  const isDash=/dash\+xml/i.test(type)||/\.mpd(?:$|\?)/i.test(entry.url)||forced==="mpd";

  if(isManifest||isDash){
    let text=await upstream.text();
    let manifestType="application/vnd.apple.mpegurl";
    if(isDash){
      manifestType="application/dash+xml";
      try{
        const base=new URL(entry.url);
        base.hash="";
        base.pathname=base.pathname.slice(0,base.pathname.lastIndexOf("/")+1);
        const baseUrl=base.toString();
        const proxyBase=await saveManifestBase(baseUrl,entry.referer);
        if(proxyBase){
          text=text.replace(/<BaseURL(\s[^>]*)?>([\s\S]*?)<\/BaseURL>/gi,(_m,attrs,raw)=>`<BaseURL${attrs||""}>${proxyBase}${encodeURI(raw.trim()).replace(/%24/g,"$")}</BaseURL>`);
          if(!/<BaseURL(?:\s[^>]*)?>/i.test(text))text=text.replace(/(<MPD\b[^>]*>)/i,`$1<BaseURL>${proxyBase}</BaseURL>`);
          text=text.replace(/\b(media|initialization)="(https?:\/\/[^"]+)"/gi,(_m,key,value)=>`${key}="${proxyBase}${encodeURIComponent(value)}"`);
        }
      }catch{}
    }else text=await rewriteManifest(text,entry.url,entry.referer);
    return new NextResponse(text,{status:200,headers:{
      "Content-Type":manifestType,
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Expose-Headers":"Content-Length, Content-Range, Accept-Ranges, Content-Type",
    }});
  }

  const responseType=forced==="mp4"?"video/mp4":(type.split(";")[0]||"video/mp4");
  const responseHeaders=new Headers();
  responseHeaders.set("Content-Type",responseType);
  responseHeaders.set("Accept-Ranges",upstream.headers.get("accept-ranges")||"bytes");
  for(const name of ["content-length","content-range","etag","last-modified"]){
    const value=upstream.headers.get(name);
    if(value)responseHeaders.set(name,value);
  }
  responseHeaders.set("Cache-Control","no-store");
  responseHeaders.set("Access-Control-Allow-Origin","*");
  responseHeaders.set("Access-Control-Expose-Headers","Content-Length, Content-Range, Accept-Ranges, Content-Type");
  responseHeaders.set("Cross-Origin-Resource-Policy","cross-origin");

  console.info("[TogetherTV stream] Upstream video response",JSON.stringify({
    status:upstream.status,
    requestedRange:Boolean(range),
    contentType:responseType,
    contentLength:upstream.headers.get("content-length")||null,
    contentRange:upstream.headers.get("content-range")||null,
    acceptRanges:upstream.headers.get("accept-ranges")||null,
  }));

  return new NextResponse(upstream.body,{status:upstream.status,headers:responseHeaders});
}
