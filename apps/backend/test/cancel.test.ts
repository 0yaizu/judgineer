import { expect, test } from "bun:test";
import type { z } from "zod";
import { type GenerateOpts, type generate, setAI } from "../src/ai/client";
import { api, chat, installFakeAI, setup } from "./helpers/fake-ai";

installFakeAI();

// 中断されるまで返さない偽の生成。始まったことと、止められたことを外から見られるようにする
// (helpers の overrides は同期の返り値しか受けないので、setAI で生成ごと差し替える)
function hangUntilAborted() {
  let started!: () => void;
  const begun = new Promise<void>((r) => {
    started = r;
  });
  const seen = { aborted: false };
  const fn = ((o: GenerateOpts<z.ZodType>) =>
    new Promise((_, reject) => {
      started();
      o.signal?.addEventListener("abort", () => {
        seen.aborted = true;
        reject(new Error("killed"));
      });
    })) as unknown as typeof generate;
  return { fn, begun, seen };
}

test("キャンセルすると生成が止まり、409 で cancelled を返し、発言は保存されない", async () => {
  const { p } = await setup();
  const hang = hangUntilAborted();
  setAI(hang.fn);

  const pending = chat(p, "I1", { text: "デバッグ画面が見えている" });
  await hang.begun;
  const cancel = await api<{ cancelled: number }>("POST", `${p}/cancel`);
  expect(cancel.status).toBe(200);
  expect(cancel.data.cancelled).toBeGreaterThanOrEqual(1);

  const res = await pending;
  expect(res.status).toBe(409);
  expect(res.data).toMatchObject({ cancelled: true });
  expect(hang.seen.aborted).toBe(true);
  const again = await api("GET", p);
  expect(again.data.issues[0]?.chat).toEqual([]);
});

test("動いている生成がなければ、止めた数は 0", async () => {
  const { p } = await setup();
  const res = await api<{ cancelled: number }>("POST", `${p}/cancel`);
  expect(res.status).toBe(200);
  expect(res.data.cancelled).toBe(0);
});

test("ほかのセッションのキャンセルでは止まらない", async () => {
  const a = await setup();
  const b = await setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let started!: () => void;
  const begun = new Promise<void>((r) => {
    started = r;
  });
  setAI((async () => {
    started();
    await gate;
    return {
      messages: [{ role: "senior", name: "先輩", text: "続けよう" }],
      phase: "investigate",
    };
  }) as unknown as typeof generate);

  const pending = chat(a.p, "I1", { text: "ログを見た" });
  await begun;
  const cancel = await api<{ cancelled: number }>("POST", `${b.p}/cancel`);
  expect(cancel.data.cancelled).toBe(0);
  release();
  const res = await pending;
  expect(res.status).toBe(200);
});

test("キャンセルしたあとの新しい依頼は、普通に動く", async () => {
  const { p } = await setup();
  const hang = hangUntilAborted();
  setAI(hang.fn);
  const first = chat(p, "I1", { text: "デバッグ画面が見えている" });
  await hang.begun;
  await api("POST", `${p}/cancel`);
  expect((await first).status).toBe(409);

  setAI((async () => ({
    messages: [{ role: "senior", name: "先輩", text: "ログを見て" }],
    phase: "investigate",
  })) as unknown as typeof generate);
  const second = await chat(p, "I1", { hint: true });
  expect(second.status).toBe(200);
});

test("存在しないセッションのキャンセルは 404", async () => {
  const res = await api("POST", "/api/projects/nope/cancel");
  expect(res.status).toBe(404);
});
