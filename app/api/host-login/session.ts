import {createHmac,timingSafeEqual} from "node:crypto";
import type {NextRequest} from "next/server";
export const COOKIE="togethertv_host";
const lifetime=7*24*60*60;
function secret(){return process.env.HOST_SESSION_SECRET||""}
function sign(payload:string){return createHmac("sha256",secret()).update(payload).digest("base64url")}
export function validHostSession(req:NextRequest){const s=secret(),token=req.cookies.get(COOKIE)?.value;if(!s||!token)return false;const parts=token.split(".");if(parts.length!==2)return false;const expected=sign(parts[0]);const a=Buffer.from(parts[1]),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return false;try{const p=JSON.parse(Buffer.from(parts[0],"base64url").toString());return p.exp>Math.floor(Date.now()/1000)&&p.v===1}catch{return false}}
export function makeHostToken(){const payload=Buffer.from(JSON.stringify({v:1,exp:Math.floor(Date.now()/1000)+lifetime})).toString("base64url");return payload+"."+sign(payload)}
export function hostCookie(token:string,maxAge=lifetime){return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==="production"?"; Secure":""}`}
export function safeEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
