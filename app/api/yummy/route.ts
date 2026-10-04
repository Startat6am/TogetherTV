import { NextRequest, NextResponse } from "next/server";

const API = "https://api.yani.tv";

function cleanToken(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = cleanToken(body?.token);
    const action = body?.action;
    if (!token) return NextResponse.json({ error: "Нужен X-Application" }, { status: 400 });

    let path = "";
    const params = new URLSearchParams();

    if (action === "search") {
      const q = typeof body?.query === "string" ? body.query.trim() : "";
      if (!q) return NextResponse.json({ error: "Введите название" }, { status: 400 });
      path = "/search";
      params.set("q", q);
      params.set("limit", "10");
      params.set("offset", "0");
    } else if (action === "anime") {
      const id = String(body?.id ?? "").trim();
      if (!id) return NextResponse.json({ error: "Не указан anime id" }, { status: 400 });
      path = "/anime/" + encodeURIComponent(id);
      params.set("need_videos", "1");
    } else {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }

    const response = await fetch(API + path + (params.size ? "?" + params.toString() : ""), {
      headers: {
        "X-Application": token,
        "Accept": "application/json",
        "Accept-Language": "ru",
      },
      cache: "no-store",
    });

    const text = await response.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok) {
      return NextResponse.json(
        { error: `YummyAnime API: HTTP ${response.status}`, data },
        { status: response.status }
      );
    }

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Не удалось обратиться к YummyAnime API" }, { status: 500 });
  }
}
