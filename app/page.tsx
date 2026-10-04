"use client";
import { useEffect, useRef, useState } from "react";

type State = { url:string; playing:boolean; position:number; updatedAt:number; title:string };
const initial:State={url:"",playing:false,position:0,updatedAt:Date.now(),title:"Пока ничего не включено"};

export default function Home(){
 const [state,setState]=useState<State>(initial); const [admin,setAdmin]=useState(false);
 const [url,setUrl]=useState(""); const [title,setTitle]=useState(""); const [token,setToken]=useState("");
 const [room,setRoom]=useState("main"); const video=useRef<HTMLVideoElement>(null);

 useEffect(()=>{setRoom(location.hash.slice(1)||"main")},[]);
 useEffect(()=>{const load=async()=>{try{const r=await fetch("/api/state?room="+encodeURIComponent(room),{cache:"no-store"});if(r.ok){const x=await r.json();if(x.state)setState(x.state)}}catch{}};load();const id=setInterval(load,1000);return()=>clearInterval(id)},[room]);
 useEffect(()=>{const v=video.current;if(!v||!state.url)return;const p=state.playing?state.position+(Date.now()-state.updatedAt)/1000:state.position;if(Math.abs(v.currentTime-p)>1)v.currentTime=Math.max(0,p);if(state.playing)v.play().catch(()=>{});else v.pause()},[state]);

 const publish=async(patch:Partial<State>)=>{const next={...state,...patch,updatedAt:Date.now()};setState(next);await fetch("/api/state?room="+encodeURIComponent(room),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(next)}).catch(()=>{})};
 const pos=()=>video.current?.currentTime||state.position;

 return <main><header><div><b className="logo">TogetherTV</b><span className="muted"> watch party</span></div><button className="ghost" onClick={()=>setAdmin(!admin)}>{admin?"Закрыть админку":"Админ"}</button></header>
 <div className="room">Комната: <b>{room}</b></div>
 <section className="hero"><div className="player"><video ref={video} controls playsInline src={state.url||undefined}/>{!state.url&&<div className="empty"><div className="play">▶</div><h1>Готовы смотреть вместе</h1><p>Открой эту ссылку на другом телефоне — состояние комнаты будет общим.</p></div>}</div>
 <div className="now"><span>Сейчас смотрим</span><strong>{state.title}</strong><i className={state.playing?"live":""}>{state.playing?"● PLAY":"Ⅱ PAUSE"}</i></div></section>
 {admin&&<aside className="admin"><h2>Панель администратора</h2>
 <label>YummyAnime Public Token <small>X-Application</small><input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="Введи ключ здесь"/></label>
 <label>Ссылка на видео <small>MP4 / M3U8 / разрешённый источник</small><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."/></label>
 <label>Название<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название серии"/></label>
 <div className="actions"><button onClick={()=>publish({url,title:title||"TogetherTV",playing:false,position:0})}>Установить</button><button onClick={()=>publish({playing:true,position:pos()})}>▶ Play для всех</button><button onClick={()=>publish({playing:false,position:pos()})}>Ⅱ Pause для всех</button><button onClick={()=>publish({playing:false,position:0})}>↺ В начало</button></div>
 <p className="hint">Состояние комнаты синхронизируется через API. Ключ X-Application пока не сохраняется и не отправляется на сервер.</p></aside>}
 </main>;
}