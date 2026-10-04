"use client";

import { useEffect, useRef, useState } from "react";

type Probe = { at: string; event: string; detail?: string };
type Source = { quality?: string; url: string; kind?: string };

const stamp = () => new Date().toLocaleTimeString();

export default function DiagnosticsPage() {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState("");
  const [iframe, setIframe] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probe, setProbe] = useState<Record<string, string> | null>(null);
  const [logs, setLogs] = useState<Probe[]>([]);
  const [error, setError] = useState("");
  const [playingUrl, setPlayingUrl] = useState("");

  const log = (event: string, detail?: string) =>
    setLogs((old) => [{ at: stamp(), event, detail }, ...old].slice(0, 60));

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const events = ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "stalled", "suspend", "abort", "emptied", "error"];
    const handlers = new Map<string, () => void>();
    for (const name of events) {
      const handler = () => {
        const mediaError = v.error;
        const detail = name === "error"
          ? `MediaError code=${mediaError?.code ?? "?"}; message=${mediaError?.message || "нет сообщения"}; networkState=${v.networkState}; readyState=${v.readyState}`
          : `networkState=${v.networkState}; readyState=${v.readyState}; currentTime=${v.currentTime.toFixed(2)}`;
        log(name, detail);
        if (name === "error") setError(detail);
      };
      handlers.set(name, handler);
      v.addEventListener(name, handler);
    }
    return () => {
      for (const [name, handler] of handlers) v.removeEventListener(name, handler);
    };
  }, []);

  const loadUrl = (value: string) => {
    const v = video.current;
    const trimmed = value.trim();
    if (!v || !trimmed) return;
    setError("");
    setProbe(null);
    setLogs([]);
    setUrl(trimmed);
    setPlayingUrl(trimmed);
    log("manual-load", trimmed);
    v.pause();
    v.removeAttribute("src");
    v.load();
    v.src = trimmed;
    v.load();
  };

  const inspectResponse = async () => {
    const target = url.trim();
    if (!target) return;
    setProbeBusy(true);
    setProbe(null);
    try {
      const parsed = new URL(target, window.location.origin);
      const sameOrigin = parsed.origin === window.location.origin;
      const response = await fetch(parsed.toString(), {
        method: "GET",
        headers: { Range: "bytes=0-63" },
        cache: "no-store",
      });
      const bytes = new Uint8Array(await response.arrayBuffer()).slice(0, 64);
      const ascii = Array.from(bytes, (b) => b >= 32 && b <= 126 ? String.fromCharCode(b) : ".");
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
      const info: Record<string, string> = {
        requestedUrl: parsed.toString(),
        origin: sameOrigin ? "same-origin" : "cross-origin",
        status: String(response.status),
        contentType: response.headers.get("content-type") || "(не указан)",
        contentLength: response.headers.get("content-length") || "(не указан)",
        contentRange: response.headers.get("content-range") || "(не указан)",
        acceptRanges: response.headers.get("accept-ranges") || "(не указан)",
        bytesRead: String(bytes.length),
        firstBytesAscii: ascii.join(""),
        firstBytesHex: hex || "(пусто)",
        looksLikeHtml: /<!doctype|<html|access denied|forbidden/i.test(ascii.join("")),
        looksLikeMp4: bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp",
        looksLikeHls: ascii.join("").trimStart().startsWith("#EXTM3U"),
      };
      setProbe(info);
      log("http-probe", `HTTP ${response.status}; ${info.contentType}; ${info.contentRange}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setProbe({ error: message, note: "Браузер не разрешил прочитать ответ (возможно CORS). Это само по себе не доказывает, что видео недоступно." });
      log("http-probe-failed", message);
    } finally {
      setProbeBusy(false);
    }
  };

  const resolveIframe = async () => {
    if (!iframe.trim()) return;
    setBusy(true);
    setError("");
    setSources([]);
    try {
      const response = await fetch("/api/yummy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "resolve", iframe: iframe.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const resolved: Source[] = Array.isArray(data.sources) ? data.sources : [];
      setSources(resolved);
      log("resolve-iframe", `HTTP ${response.status}; источников: ${resolved.length}`);
      if (!resolved.length) setError("Resolver не вернул ни одного источника.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      log("resolve-failed", message);
    } finally {
      setBusy(false);
    }
  };

  const current = video.current;
  const facts = [
    ["canPlayType MP4", current?.canPlayType("video/mp4") || "—"],
    ["canPlayType HLS", current?.canPlayType("application/vnd.apple.mpegurl") || "—"],
    ["MediaError code", current?.error?.code ? String(current.error.code) : "—"],
    ["networkState", current ? String(current.networkState) : "—"],
    ["readyState", current ? String(current.readyState) : "—"],
    ["currentSrc", current?.currentSrc || playingUrl || "—"],
  ];

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "28px 18px 60px", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}>
      <a href="/" style={{ color: "#a1a1aa", textDecoration: "none" }}>← TogetherTV</a>
      <h1 style={{ fontSize: 30, margin: "14px 0 6px" }}>Диагностика видеоплеера</h1>
      <p style={{ color: "#a1a1aa", marginTop: 0 }}>Страница собирает проверяемые данные: HTTP-ответ, сигнатуру первых байтов и ошибки HTMLMediaElement. Ничего не меняет в комнате просмотра.</p>

      <section style={card}>
        <h2 style={h2}>1. Проверить ссылку на видео</h2>
        <label style={label}>URL видео или /api/stream?token=…
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Вставь URL потока или прокси" style={input} />
        </label>
        <div style={actions}>
          <button style={button} onClick={() => loadUrl(url)} disabled={!url.trim()}>Загрузить в тестовый плеер</button>
          <button style={buttonSecondary} onClick={inspectResponse} disabled={!url.trim() || probeBusy}>{probeBusy ? "Проверяю…" : "Проверить HTTP и сигнатуру"}</button>
        </div>
        <video ref={video} controls playsInline style={{ display: "block", width: "100%", marginTop: 16, maxHeight: 480, background: "#000", borderRadius: 10 }} />
        {error && <pre style={errorStyle}>{error}</pre>}
      </section>

      <section style={card}>
        <h2 style={h2}>2. Проверить resolver YummyAnime / Aksor / Kodik</h2>
        <label style={label}>Iframe / URL плеера
          <input value={iframe} onChange={(e) => setIframe(e.target.value)} placeholder="https://… ссылка на страницу плеера" style={input} />
        </label>
        <button style={button} onClick={resolveIframe} disabled={busy || !iframe.trim()}>{busy ? "Проверяю источники…" : "Разрешить источник и проверить качества"}</button>
        <p style={{ color: "#a1a1aa", fontSize: 13 }}>Использует существующий серверный resolver. Результат и причины отказа отображаются ниже; подробности также попадают в Vercel Runtime Logs.</p>
        {sources.map((source, index) => (
          <div key={source.url + index} style={{ borderTop: "1px solid #3f3f46", padding: "12px 0", overflowWrap: "anywhere" }}>
            <b>{source.quality || "Источник"} · {source.kind || "media"}</b>
            <div style={{ color: "#a1a1aa", fontSize: 12, margin: "5px 0 10px" }}>{source.url}</div>
            <button style={buttonSecondary} onClick={() => { setUrl(source.url); loadUrl(source.url); }}>Тестировать это качество</button>
            <button style={{ ...buttonSecondary, marginLeft: 8 }} onClick={() => { setUrl(source.url); log("selected-source", source.url); }}>Подставить URL</button>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={h2}>3. Данные плеера</h2>
        <div style={grid}>
          {facts.map(([name, value]) => <div key={name} style={fact}><div style={{ color: "#a1a1aa", fontSize: 12 }}>{name}</div><div style={{ overflowWrap: "anywhere", marginTop: 4 }}>{value}</div></div>)}
        </div>
        <h3 style={{ fontSize: 16, marginTop: 20 }}>HTTP / первые байты</h3>
        {probe ? <pre style={pre}>{JSON.stringify(probe, null, 2)}</pre> : <p style={{ color: "#a1a1aa" }}>Нажми «Проверить HTTP и сигнатуру».</p>}
        <div style={actions}>
          <button style={buttonSecondary} onClick={() => { const text = JSON.stringify({ testedAt: new Date().toISOString(), url, playingUrl, probe, player: facts, logs }, null, 2); void navigator.clipboard?.writeText(text); }}>Скопировать отчёт</button>
          <button style={buttonSecondary} onClick={() => setLogs([])}>Очистить журнал</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {logs.map((entry, index) => <div key={entry.at + entry.event + index} style={{ borderTop: "1px solid #27272a", padding: "8px 0", fontSize: 13 }}>
            <span style={{ color: "#a1a1aa" }}>{entry.at}</span> <b style={{ marginLeft: 8 }}>{entry.event}</b>
            {entry.detail && <div style={{ color: "#d4d4d8", overflowWrap: "anywhere", marginTop: 3 }}>{entry.detail}</div>}
          </div>)}
        </div>
      </section>
      <p style={{ color: "#71717a", fontSize: 12 }}>Не вставляй сюда приватные ключи. Отчёт содержит URL источника — перед отправкой третьим лицам проверь, нет ли в нём токенов доступа.</p>
    </main>
  );
}

const card: React.CSSProperties = { background: "#18181b", border: "1px solid #3f3f46", borderRadius: 14, padding: 18, marginTop: 16 };
const h2: React.CSSProperties = { fontSize: 19, margin: "0 0 14px" };
const label: React.CSSProperties = { display: "grid", gap: 8, fontSize: 14, marginBottom: 12 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#09090b", color: "#fafafa", border: "1px solid #52525b", borderRadius: 8, padding: "12px 13px", fontSize: 14 };
const actions: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 };
const button: React.CSSProperties = { border: 0, borderRadius: 8, padding: "10px 14px", color: "#fff", background: "#2563eb", fontWeight: 600, cursor: "pointer" };
const buttonSecondary: React.CSSProperties = { border: "1px solid #52525b", borderRadius: 8, padding: "9px 12px", color: "#f4f4f5", background: "#27272a", cursor: "pointer" };
const pre: React.CSSProperties = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#09090b", padding: 12, borderRadius: 8, fontSize: 12 };
const errorStyle: React.CSSProperties = { ...pre, color: "#fca5a5" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 };
const fact: React.CSSProperties = { background: "#09090b", padding: 10, borderRadius: 8, fontSize: 13 };
