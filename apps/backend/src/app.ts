import type { Health } from "@tka/shared";
import { Hono } from "hono";

// ルートはチェーンで繋ぐ（AppType がフロントの hc<AppType> に型を渡す）
const app = new Hono().basePath("/api").get("/health", (c) => {
  const body: Health = { status: "ok" };
  return c.json(body);
});

export type AppType = typeof app;
export default app;
