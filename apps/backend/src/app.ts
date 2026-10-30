import type { Health } from "@tka/shared";
import { Hono } from "hono";
import { AIError, CancelledError } from "./ai/client";
import { inSession } from "./ai/session";
import { DEMO_LINES } from "./demo";
import { HttpError } from "./http";
import apps from "./routes/apps";
import issues from "./routes/issues";
import meta from "./routes/meta";
import projects from "./routes/projects";
import targets from "./routes/targets";

// DNS rebinding 対策: ブラウザは悪意あるサイトの名前のまま 127.0.0.1 に届けられるので、
// Host が自分宛て以外なら断る (ポートは見ない。開発時の Vite proxy は元のポートのまま渡す)
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

// ルートはチェーンで繋ぐ（AppType がフロントの hc<AppType> に型を渡す）
const app = new Hono()
  .basePath("/api")
  .use(async (c, next) => {
    const host = c.req.header("host"); // 無いのはブラウザではない (HTTP/1.1 は必ず付く)
    if (host && !LOCAL_HOSTS.has(host.replace(/:\d+$/, "")))
      throw new HttpError(403, "このホスト名ではアクセスできません");
    await next();
  })
  // セッション (プロジェクト) ごとの処理として動かし、キャンセルで AI の生成をまとめて止められるようにする
  .use("/projects/:pid/*", (c, next) => inSession(c.req.param("pid"), next))
  .onError((e, c) => {
    if (e instanceof CancelledError)
      return c.json({ detail: e.message, cancelled: true }, 409);
    if (e instanceof AIError) return c.json({ detail: e.message }, 502);
    if (e instanceof HttpError) return c.json({ detail: e.message }, e.status);
    console.error(e);
    return c.json({ detail: "サーバーでエラーが起きました" }, 500);
  })
  .get("/health", (c) => {
    const body: Health = {
      status: "ok",
      pid: process.pid,
      demo_lines: process.env.DEMO === "1" ? DEMO_LINES : undefined,
    };
    return c.json(body);
  })
  .route("/", meta)
  .route("/apps", apps)
  .route("/targets", targets)
  .route("/projects", projects)
  .route("/projects", issues);

export type AppType = typeof app;
export default app;
