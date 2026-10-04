import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

type State={url:string;playing:boolean;position:number;updatedAt:number;title:string};
const fallback=new Map<string,State>();
const empty=():State=>({url:"",playing:false,position:0,updatedAt:Date.now(),title:"Пока ничего не включено"});
function key(req:NextRequest){return `togethertv:room:${(new URL(req.url).searchParams.get("room")||"main").slice(0,80)}`}
function redis(){if(!process.env.UPSTASH_REDIS_REST_URL||!process.env.UPSTASH_REDIS_REST_TOKEN)return null;return Redis.fromEnv()}

export async function GET(req:NextRequest){
 const r=redis(); let state:State|null=null;
 if(r) state=await r.get<State>(key(req)); else state=fallback.get(key(req))||null;
 return NextResponse.json({state:state||empty()},{headers:{"Cache-Control":"no-store"}})
}
export async function POST(req:NextRequest){
 const body=await req.json() as State;
 if(!body||typeof body.url!=="string"||typeof body.position!=="number"||typeof body.playing!=="boolean")return NextResponse.json({error:"bad state"},{status:400});
 const state={...body,updatedAt:Date.now()}; const r=redis();
 if(r) await r.set(key(req),state,{ex:86400}); else fallback.set(key(req),state);
 return NextResponse.json({ok:true})
}