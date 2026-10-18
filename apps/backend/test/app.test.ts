import { expect, test } from "bun:test";
import { healthSchema } from "@tka/shared";
import app from "../src/app";

test("GET /api/health returns ok", async () => {
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(healthSchema.parse(await res.json())).toEqual({ status: "ok" });
});

test("Host が自分宛て以外なら 403 (DNS rebinding 対策)。ポートは見ない", async () => {
  const get = (host: string) =>
    app.request("/api/health", { headers: { host } });
  expect((await get("evil.example")).status).toBe(403);
  expect((await get("evil.example:3001")).status).toBe(403);
  expect((await get("127.0.0.1:3001")).status).toBe(200);
  expect((await get("localhost:3000")).status).toBe(200);
});
