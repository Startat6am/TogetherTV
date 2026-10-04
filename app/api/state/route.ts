import { NextRequest, NextResponse } from "next/server";
type State={url:string;playing:boolean;position:number;updatedAt:number;title:string};
const memory=new Map<string,State>();
function key(req:NextRequest){return (new URL(req.url).searchParams.get("room")||"main").slice(0,80)}
export async function GET(req:NextRequest){const state=memory.get(key(req))||{url:"",playing:false,position:0,updatedAt:Date.now(),title:"Пока ничего не включено"};return NextResponse.json({state},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:NextRequest){const body=await req.json() as State;if(!body||typeof body.url!=="string")return NextResponse.json({error:"bad state"},{status:400});memory.set(key(req),{...body,updatedAt:Date.now()});return NextResponse.json({ok:true})}