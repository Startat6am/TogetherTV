"use client";
import { useEffect, useRef, useState } from "react";

type State = { url:string; playing:boolean; position:number; updatedAt:number; title:string };
const KEY="togethertv-state-v1";
const initial:State={url:"",playing:false,position:0,updatedAt:Date.now(),title:"Пока ничего не включено"};

export default function Home(){
 const [state,setState]=useState<State>(initial); const [admin,setAdmin]=useState(false); const [url,setUrl]=useState(""); const [title,setTitle]=useState(""); const [token,setToken]=useState(""); const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{try{const x=localStorage.getItem(KEY);if(x)setState(JSON.parse(x));}catch{} const on=(e:StorageEvent)=>{if(e.key===KEY&&e.newValue)setState(JSON.parse(e.newValue));};window.addEventListener("storage",on);return()=>window.removeEventListener("storage",on)},[]);
 useEffect(()=>{const v=video.current;if(!v||!state.url)return; const p=state.playing?state.position+(Date.now()-state.updatedAt)/1000:state.position; if(Math.abs(v.currentTime-p)>1.5)v.currentTime=Math.max(0,p); if(state.playing)v.play().catch(()=>{}); else v.pause();},[state]);
 const publish=(patch:Partial<State>)=>{const next={...state,...patch,updatedAt:Date.now()};setState(next);localStorage.setItem(KEY,JSON.stringify(next));};
 const setVideo=()=>publish({url,title:title||"TogetherTV"});
 return <main><header><div><b className="logo">TogetherTV</b><span className="muted"> watch party</span></div><button className="ghost" onClick={()=>setAdmin(!admin)}>{admin?"Закрыть админку":"Админ"}</button></header>
 <section className="hero"><div className="player"><video ref={video} controls playsInline src={state.url||undefined}/>{!state.url&&<div className="empty"><div className="play">▶</div><h1>Готовы смотреть вместе</h1><p>Администратор выбирает видео — остальные зрители автоматически подключаются к общей позиции.</p></div>}</div>
 <div className="now"><span>Сейчас смотрим</span><strong>{state.title}</strong><i className={state.playing?"live":""}>{state.playing?"● PLAY":"Ⅱ PAUSE"}</i></div></section>
 {admin&&<aside className="admin"><h2>Панель администратора</h2><label>YummyAnime Public Token <small>X-Application</small><input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="Введи ключ здесь"/></label><label>Ссылка на видео <small>MP4 / M3U8 / разрешённый embed</small><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."/></label><label>Название<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название серии"/></label><div className="actions"><button onClick={setVideo}>Установить</button><button onClick={()=>publish({playing:true,position:video.current?.currentTime||state.position})}>▶ Play для всех</button><button onClick={()=>publish({playing:false,position:video.current?.currentTime||state.position})}>Ⅱ Pause для всех</button><button onClick={()=>publish({playing:false,position:0})}>↺ В начало</button></div><p className="hint">Ключ API не сохраняется и не отправляется в чат. В этой первой версии синхронизация работает между вкладками одного устройства; следующим шагом перенесём состояние в realtime-сервер.</p></aside>}
 </main>;
}