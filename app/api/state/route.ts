import {NextRequest,NextResponse} from "next/server";
import {Redis} from "@upstash/redis";
type State={videoId:string;playing:boolean;position:number;updatedAt:number;title:string;hostId?:string};
const memory=new Map<string,State>(),memoryHosts=new Map<string,string>();
const room=(req:NextRequest)=>(new URL(req.url).searchParams.get("room")||"main").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80)||"main";
const key=(r:string)=>`togethertv:room:${r}`,hostKey=(r:string)=>`togethertv:room:${r}:host`;
function redis(){return process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN?Redis.fromEnv():null}
const empty=():State=>({videoId:"",playing:false,position:0,updatedAt:0,title:"Пока ничего не включено"});
export async function GET(req:NextRequest){try{const r=room(req),db=redis();const [state,hostId]=db?await Promise.all([db.get<State>(key(r)),db.get<string>(hostKey(r))]):[memory.get(key(r))||null,memoryHosts.get(r)||null];return NextResponse.json({state:state||empty(),hostId:hostId||null},{headers:{"Cache-Control":"no-store"}})}catch{return NextResponse.json({error:"room_unavailable"},{status:503})}}
export async function POST(req:NextRequest){let b:any;try{b=await req.json()}catch{return NextResponse.json({error:"invalid_json"},{status:400})}const r=room(req),db=redis();if(typeof b.participantId!=="string"||b.participantId.length>100)return NextResponse.json({error:"participant_required"},{status:400});
try{if(b.action==="claim"){if(db){await db.set(hostKey(r),b.participantId,{nx:true,ex:86400*30});const hostId=await db.get<string>(hostKey(r));return NextResponse.json({hostId})}if(!memoryHosts.has(r))memoryHosts.set(r,b.participantId);return NextResponse.json({hostId:memoryHosts.get(r)})}
const hostId=db?await db.get<string>(hostKey(r)):memoryHosts.get(r);if(!hostId||hostId!==b.participantId)return NextResponse.json({error:"host_only",message:"Только ведущий может менять воспроизведение."},{status:403});
if(typeof b.videoId!=="string"||(b.videoId!==""&&!/^[\w-]{11}$/.test(b.videoId))||typeof b.position!=="number"||!Number.isFinite(b.position)||b.position<0||typeof b.playing!=="boolean"||typeof b.title!=="string")return NextResponse.json({error:"bad_state"},{status:400});
const state:State={videoId:b.videoId,position:Math.min(b.position,604800),playing:b.playing,title:b.title.slice(0,200),updatedAt:Date.now(),hostId};if(db)await db.set(key(r),state,{ex:86400});else memory.set(key(r),state);return NextResponse.json({ok:true,state},{headers:{"Cache-Control":"no-store"}})}catch{return NextResponse.json({error:"room_write_failed"},{status:503})}}
