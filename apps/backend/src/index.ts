import "./db"; // 起動時にマイグレーションを確実に流す
import app from "./app";

export default {
  port: Number(process.env.PORT ?? 3001),
  hostname: "127.0.0.1",
  // 既定の 10 秒だと、AI を待つ間（台本づくりは1〜2分）に接続が切られて 502 になる。AI 側にタイムアウトがあるので、ここでは切らない
  idleTimeout: 0,
  fetch: app.fetch,
};
