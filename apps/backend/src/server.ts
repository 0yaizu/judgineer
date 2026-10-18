import app from "./app";
import { embeddedAssets } from "./assets";
import { config } from "./config";
import { seedTargets } from "./targets";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

const assets = await embeddedAssets();
// 埋め込みのフロントがあれば /api 以外はそれを返す (SPA なので、無いパスは _shell.html)。
// 開発時は vite が返すので、API だけ
const fetch: (req: Request) => Response | Promise<Response> = assets
  ? (req) => {
      const { pathname } = new URL(req.url);
      if (pathname === "/api" || pathname.startsWith("/api/"))
        return app.fetch(req);
      let path: string;
      try {
        path = decodeURIComponent(pathname);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      const key = `public${path}`;
      const file =
        pathname !== "/" && !key.includes("..") ? assets.get(key) : undefined;
      const body = file ?? assets.get("public/_shell.html");
      if (!body) return new Response("Not Found", { status: 404 });
      const ext = file ? (pathname.split(".").pop() ?? "") : "html";
      return new Response(body, {
        headers: {
          "content-type": MIME[ext] ?? "application/octet-stream",
          // ファイル名にハッシュが付く assets/ だけ長く持たせる
          "cache-control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        },
      });
    }
  : app.fetch;

seedTargets();

export const serverOptions = {
  port: config.port,
  // ローカル専用ツール。外部に公開しない
  hostname: "127.0.0.1",
  // 既定の 10 秒だと、AI を待つ間（台本づくりは1〜2分）に接続が切られて 502 になる。AI 側にタイムアウトがあるので、ここでは切らない
  idleTimeout: 0,
  fetch,
};
