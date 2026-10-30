import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type generate, setAI } from "../src/ai/client";
import { DEMO_LINES, demoAI } from "../src/demo";
import { registerTarget } from "../src/targets";
import type { Issue } from "../src/types";
import { api, chat, type Payload } from "./helpers/fake-ai";

afterEach(() => setAI(null));

test("台本AI: 登録 → 分析 → 出来事1を DEMO_LINES で最後まで → 反映", async () => {
  setAI(demoAI as unknown as typeof generate);
  const target = registerTarget(
    resolve(import.meta.dir, "../../../samples/clinic_results_api"),
  );
  const list = await api<{ id: string; background: Record<string, string> }[]>(
    "GET",
    "/api/targets",
  );
  const reg = await api("POST", "/api/projects", {
    target_id: target.id,
    background: list.data.find((t) => t.id === target.id)?.background,
  });
  expect(reg.status).toBe(200);
  const p = `/api/projects/${reg.data.id}`;
  const done = await api<Payload>("POST", `${p}/analyze`);
  expect(done.status).toBe(200);
  expect(done.data.issues.map((i) => i.id)).toEqual(["I1", "I2", "I3"]);
  expect(done.data.issues[0]?.title).toContain("他人の患者ID");
  expect(done.data.uncovered_features).toEqual([]);

  const start = await api<Issue>("POST", `${p}/issues/I1/chat/start`);
  expect(start.data.chat.map((m) => m.role)).toEqual(["stakeholder", "senior"]);

  let i = start.data;
  for (const line of DEMO_LINES.slice(0, 3)) {
    i = (await chat(p, "I1", { text: line })).data;
  }
  expect(i.phase).toBe("ready");
  expect(i.plan_draft?.plan).toBe(DEMO_LINES[2]);

  const r = await api<{ issue: Issue; project: Payload }>(
    "POST",
    `${p}/issues/I1/commit`,
    { plan: i.plan_draft?.plan },
  );
  expect(r.status).toBe(200);
  i = r.data.issue;
  expect(i.fix?.diffs[0]?.file).toBe("app.py");
  expect(i.fix?.verification?.remaining).toEqual([]);
  expect(i.fix?.verification?.syntax).toBe("ok");
  expect(i.phase).toBe("reflect");

  for (const line of DEMO_LINES.slice(3)) {
    i = (await chat(p, "I1", { text: line })).data;
  }
  expect(i.phase).toBe("done");
  expect(i.lesson).toBe(DEMO_LINES.at(-1) as string);
}, 60_000);
