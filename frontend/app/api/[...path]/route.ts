/**
 * Same-origin proxy: the browser only talks to this Next.js app; requests to /api/* are
 * forwarded to the FastAPI backend (BACKEND_URL). Cookies stay first-party and the backend
 * URL is a runtime setting (works with the standalone Docker image).
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
const HOP_BY_HOP = ["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade"];

async function proxy(req: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const search = new URL(req.url).search;
  const target = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers(req.headers);
  HOP_BY_HOP.forEach((h) => headers.delete(h));

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch {
    return Response.json(
      { detail: "Backend-ът не е достъпен. Стартирай FastAPI сървъра (виж README)." },
      { status: 502 },
    );
  }
  const out = new Headers(res.headers);
  ["content-encoding", "content-length", "transfer-encoding", "connection"].forEach((h) => out.delete(h));
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
