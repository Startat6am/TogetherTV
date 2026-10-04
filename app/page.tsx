"use client";

import { useEffect, useRef, useState } from "react";

type State = { url:string; playing:boolean; position:number; updatedAt:number; title:string };
type Anime = Record<string, any>;
const initial:State={url:"",playing:false,position:0,updatedAt:Date.now(),title:"Пока ничего не включено"};

function pick<T=any>(obj:any, keys:string[], fallback?:T): T {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key] as T;
  return fallback as T;
}
function unwrap(data:any): any { return data?.response ?? data?.data?.response ?? data?.data ?? data; }
function animeName(a:any){ const n=pick(a,["title","name","title_ru","russian"],"Без названия"); return typeof n==="object"?pick(n,["ru","russian","english","original"],"Без названия"):n; }

export default function Home(){
 const [state,setState]=useState<State>(initial);
 const [admin,setAdmin]=useState(false);
 const [url,setUrl]=useState("");
 const [title,setTitle]=useState("");
 const [publicKey,setPublicKey]=useState("");
 const [privateKey,setPrivateKey]=useState("");
 const [keysAdded,setKeysAdded]=useState(false);
 const [room,setRoom]=useState("main");
 const [query,setQuery]=useState("");
 const [results,setResults]=useState<Anime[]>([]);
 const [selected,setSelected]=useState<Anime|null>(null);
 const [apiBusy,setApiBusy]=useState(false);
 const [apiError,setApiError]=useState("");
 const video=useRef<HTMLVideoElement>(null);

 useEffect(()=>{setRoom(location.hash.slice(1)||"main")},[]);
 useEffect(()=>{try{setPublicKey(sessionStorage.getItem("yummy_public")||"");setPrivateKey(sessionStorage.getItem("yummy_private")||"");setKeysAdded(sessionStorage.getItem("yummy_keys_ok")==="1")}catch{}},[]);
 useEffect(()=>{
   const load=async()=>{try{const r=await fetch("/api/state?room="+encodeURIComponent(room),{cache:"no-store"});if(r.ok){const x=await r.json();if(x.state)setState(x.state)}}catch{}};
   load(); const id=setInterval(load,700); return()=>clearInterval(id);
 },[room]);
 useEffect(()=>{
   const v=video.current;if(!v||!state.url)return;
   const p=state.playing?state.position+(Date.now()-state.updatedAt)/1000:state.position;
   if(Math.abs(v.currentTime-p)>0.8)v.currentTime=Math.max(0,p);
   if(state.playing)v.play().catch(()=>{});else v.pause();
 },[state]);

 const publish=async(patch:Partial<State>)=>{
   const next={...state,...patch,updatedAt:Date.now()}; setState(next);
   await fetch("/api/state?room="+encodeURIComponent(room),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(next)}).catch(()=>{});
 };
 const pos=()=>video.current?.currentTime||state.position;

 const saveKeys=async()=>{
   setApiBusy(true);setApiError("");
   try{
     const r=await fetch("/api/yummy",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"search",query:"Киберпанк",token:publicKey,privateToken:privateKey,validate:true})});
     const x=await r.json();
     if(!r.ok)throw new Error(x.error||"Ключи не прошли проверку");
     sessionStorage.setItem("yummy_public",publicKey);
     sessionStorage.setItem("yummy_private",privateKey);
     sessionStorage.setItem("yummy_keys_ok","1");
     setKeysAdded(true);
   }catch(e){setApiError(e instanceof Error?e.message:"Не удалось проверить ключ")}
   finally{setApiBusy(false)}
 };

 const clearKeys=()=>{setPublicKey("");setPrivateKey("");setKeysAdded(false);try{sessionStorage.removeItem("yummy_public");sessionStorage.removeItem("yummy_private");sessionStorage.removeItem("yummy_keys_ok")}catch{}};

 const searchAnime=async()=>{
   setApiBusy(true);setApiError("");setResults([]);setSelected(null);
   try{
     const r=await fetch("/api/yummy",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"search",query,token:publicKey,privateToken:privateKey})});
     const x=await r.json(); if(!r.ok)throw new Error(x.error||"Ошибка API");
     const root=unwrap(x.data); const list=Array.isArray(root)?root:(Array.isArray(root?.items)?root.items:(Array.isArray(root?.results)?root.results:[]));
     setResults(list);
     if(!list.length)setApiError("Ничего не найдено");
   }catch(e){setApiError(e instanceof Error?e.message:"Ошибка поиска")}
   finally{setApiBusy(false)}
 };

 const loadAnime=async(anime:Anime)=>{
   setApiBusy(true);setApiError("");setSelected(anime);
   try{
     const id=pick(anime,["id","anime_id","animeId"]);
     const alias=pick(anime,["anime_url","url","alias","slug"]);
     const r=await fetch("/api/yummy",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"anime",id:id??alias,token:publicKey,privateToken:privateKey})});
     const x=await r.json(); if(!r.ok)throw new Error(x.error||"Ошибка API");
     setSelected(unwrap(x.data));
   }catch(e){setApiError(e instanceof Error?e.message:"Ошибка загрузки тайтла")}
   finally{setApiBusy(false)}
 };

 const chooseVideo=(source:Anime)=>{
   const media=pick(source,["url","src","file","stream_url","video_url"]);
   const iframe=pick(source,["iframe_url","iframeUrl"]);
   const candidate=typeof media==="string"&&/^https?:\/\/(.+\.(mp4|m3u8)(\?.*)?$)/i.test(media)?media:"";
   if(candidate){setUrl(candidate);setTitle(`${animeName(selected)} — серия ${pick(source,["number","episode"],"")}`.trim());return;}
   if(typeof iframe==="string")setApiError("Источник найден, но это iframe. Для общей синхронизации нужен прямой MP4/M3U8.");
 };

 const videos=Array.isArray(selected?.videos)?selected.videos:Array.isArray(selected?.response?.videos)?selected.response.videos:Array.isArray(selected?.data?.videos)?selected.data.videos:[];

 return <main>
   <header><div><b className="logo">TogetherTV</b><span className="muted"> watch party</span></div><button className="ghost" onClick={()=>setAdmin(!admin)}>{admin?"Закрыть админку":"Админ"}</button></header>
   <div className="room">Комната: <b>{room}</b></div>
   <section className="hero">
     <div className="player"><video ref={video} controls playsInline src={state.url||undefined}/>{!state.url&&<div className="empty"><div className="play">▶</div><h1>Готовы смотреть вместе</h1><p>Открой эту ссылку на другом телефоне — состояние комнаты будет общим.</p></div>}</div>
     <div className="now"><span>Сейчас смотрим</span><strong>{state.title}</strong><i className={state.playing?"live":""}>{state.playing?"● PLAY":"Ⅱ PAUSE"}</i></div>
   </section>
   {admin&&<aside className="admin">
     <h2>Панель администратора</h2>

     {!keysAdded ? <div className="keysBox">
       <h3>🔐 Ключи YummyAnime</h3>
       <p className="hint">Введи Public и Private ключи. Они используются только из этого браузера и не сохраняются в комнате.</p>
       <label>Public key <small>X-Application</small><input type="password" value={publicKey} onChange={e=>setPublicKey(e.target.value)} placeholder="Public key"/></label>
       <label>Private key<input type="password" value={privateKey} onChange={e=>setPrivateKey(e.target.value)} placeholder="Private key"/></label>
       <button className="primaryWide" onClick={saveKeys} disabled={apiBusy||!publicKey.trim()}>{apiBusy?"Проверяю...":"Добавить ключи"}</button>
       {apiError&&<p className="error">{apiError}</p>}
     </div> : <div className="keysAdded"><span>✓ Ключи YummyAnime добавлены</span><button className="mini" onClick={clearKeys}>Изменить</button></div>}

     <div className="yummy">
       <h3>🔎 Поиск аниме</h3>
       <div className="searchRow"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchAnime()} placeholder="Например: Киберпанк"/><button onClick={searchAnime} disabled={apiBusy||!keysAdded||!query.trim()}>{apiBusy?"...":"Найти"}</button></div>
       {apiError&&keysAdded&&<p className="error">{apiError}</p>}
       {!!results.length&&<div className="results"><div className="muted resultCount">Найдено: {results.length}</div>{results.map((a,i)=>{
         const id=pick(a,["id","anime_id","animeId"],i);
         return <button className="result" key={String(id)+i} onClick={()=>loadAnime(a)}><b>{animeName(a)}</b><small>{pick(a,["year","type","anime_url","url"],"Нажми, чтобы открыть")}</small></button>
       })}</div>}
       {selected&&<div className="animeCard"><h3>{animeName(selected)}</h3><p className="muted">Выбери серию</p>
         {videos.length?<div className="sources">{videos.map((v:any,i:number)=><button className="source" key={i} onClick={()=>chooseVideo(v)}><b>{pick(v?.data||v,["player","name","dubbing"],"Источник")}</b><span>Серия {pick(v,["number","episode"],i+1)} · добавить</span></button>)}</div>:<p className="hint">Серии не вернулись из API для этого тайтла.</p>}
       </div>}
     </div>

     <label>Ссылка на видео <small>MP4 / M3U8 / разрешённый источник</small><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."/></label>
     <label>Название<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название серии"/></label>
     <div className="actions"><button onClick={()=>publish({url,title:title||"TogetherTV",playing:false,position:0})}>Установить</button><button onClick={()=>publish({playing:true,position:pos()})}>▶ Play для всех</button><button onClick={()=>publish({playing:false,position:pos()})}>Ⅱ Pause для всех</button><button onClick={()=>publish({playing:false,position:0})}>↺ В начало</button></div>
     <p className="hint">Ключи не попадают в состояние комнаты. Для общей синхронизации источник должен позволять воспроизведение в HTML5 video (например MP4/M3U8).</p>
   </aside>}
 </main>;
}
