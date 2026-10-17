import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AIError, setAI } from "../src/ai/client";
import { config } from "../src/config";
import type { Issue, Lesson } from "../src/types";
import {
  api,
  appPy,
  chat,
  installFakeAI,
  type Payload,
  setup,
} from "./helpers/fake-ai";

installFakeAI();

test("会話 → 方針の確定 → 反映 → 振り返り → メモ", async () => {
  const { pid, p } = await setup();
  const iid = "I1";
  const srcBefore = readFileSync(
    join(config.dataDir, "projects", pid, "src", "app.py"),
    "utf8",
  );
  const outside = join(config.dataDir, "projects", pid, "outside.txt");
  writeFileSync(outside, "orig");

  const start = await api<Issue>("POST", `${p}/issues/${iid}/chat/start`);
  expect(start.data.phase).toBe("investigate");
  expect(start.data.chat.map((m) => m.role)).toEqual(["stakeholder", "senior"]);
  expect(start.data.chat[0]?.name).toBe("B社の担当");

  let i = (await chat(p, iid, { hint: true })).data;
  expect(i.hints).toBe(1);
  expect(i.chat.at(-1)?.role).toBe("senior");

  i = (await chat(p, iid, { text: "デバッグ画面が外から見えている" })).data;
  const n = i.chat.length;
  i = (await chat(p, iid, { text: "B社が困る" })).data;
  expect(i.phase).toBe("decide");
  expect(i.chat.length).toBe(n + 1 + 3); // 発言 + AI の発言は3件まで
  expect(i.chat.some((m) => m.role === "stakeholder")).toBe(true);

  i = (
    await chat(p, iid, { text: "本番ではdebugを切って直す、B社には連絡する" })
  ).data;
  expect(i.phase).toBe("ready");
  expect(i.plan_draft?.plan).toContain("debugを切って直す");

  const r = await api<{ issue: Issue; project: Payload }>(
    "POST",
    `${p}/issues/${iid}/commit`,
    { plan: i.plan_draft?.plan },
  );
  expect(r.status).toBe(200);
  i = r.data.issue;
  expect(i.phase).toBe("reflect");
  expect(i.fix?.diffs.map((d) => d.file)).toEqual(["app.py"]);
  expect(i.feedback).toBeTruthy();
  expect(i.plan_draft).toBeUndefined();
  expect(i.chat.some((m) => m.kind === "fix")).toBe(true);
  expect(i.fix?.new_issue_ids).toEqual(["I3"]); // 新しい出来事は1件まで
  expect(r.data.project.architecture.nodes.map((x) => x.id)).toEqual([
    "api",
    "waf",
  ]);
  const issue2 = r.data.project.issues.find((x) => x.id === "I2");
  expect(issue2?.changed_by?.effect).toBe("reduced");

  // 修正は current/ にだけ入る
  const cur = await api<{ content: string }>(
    "GET",
    `${p}/file?path=app.py&version=current`,
  );
  expect(cur.data.content).toContain('host="127.0.0.1"');
  const orig = await api<{ content: string }>("GET", `${p}/file?path=app.py`);
  expect(orig.data.content).toBe(appPy);
  expect(
    readFileSync(
      join(config.dataDir, "projects", pid, "src", "app.py"),
      "utf8",
    ),
  ).toBe(srcBefore);
  expect(readFileSync(outside, "utf8")).toBe("orig");
  expect(readFileSync(join(config.targetDir, "app.py"), "utf8")).toBe(appPy);

  // 反映後も、未対応の出来事(副作用の I3)より先へは進めない
  const sim = await api<{ sim_day: number; limit: number }>(
    "POST",
    `${p}/sim`,
    { day: 999 },
  );
  expect(sim.data.sim_day).toBe(20);
  expect(sim.data.limit).toBe(20);

  i = (await chat(p, iid, { text: "B社には漏れた範囲を伝える" })).data;
  expect(i.phase).toBe("reflect");
  i = (await chat(p, iid, { text: "次は本番の設定を最初から分けておく" })).data;
  expect(i.phase).toBe("done");
  expect(i.lesson).toBe("次は本番の設定を最初から分けておく");
  const lessons = await api<Lesson[]>("GET", "/api/lessons");
  const mine = lessons.data.find((l) => l.project_id === pid);
  expect(mine?.lesson).toBe(i.lesson);
  expect(mine?.chosen).toContain("本番ではdebugを切って直す");

  const ls = await api<Issue>("POST", `${p}/issues/${iid}/lesson`, {
    lesson: " 書き直した ",
  });
  expect(ls.data.lesson).toBe("書き直した");
  expect(
    (await api<Lesson[]>("GET", "/api/lessons")).data.find(
      (l) => l.project_id === pid,
    )?.lesson,
  ).toBe("書き直した");

  const atk = await api<Issue>("POST", `${p}/issues/${iid}/attack-scenarios`);
  expect(atk.data.attack_scenarios?.length).toBe(4);
});

test("反映をやり直す途中で AI が失敗しても、前の修正は current/ に残る", async () => {
  const { p } = await setup();
  const iid = "I1";
  for (const text of [
    "デバッグ画面が外から見えている",
    "B社が困る",
    "本番ではdebugを切って直す、B社には連絡する",
  ]) {
    await chat(p, iid, { text });
  }
  const ready = await api("GET", p).then((r) =>
    r.data.issues.find((x) => x.id === iid),
  );
  const plan = ready?.plan_draft?.plan;
  expect(
    (await api("POST", `${p}/issues/${iid}/commit`, { plan })).status,
  ).toBe(200);
  const fixed = await api<{ content: string }>(
    "GET",
    `${p}/file?path=app.py&version=current`,
  );

  setAI(async () => {
    throw new AIError("失敗");
  });
  expect(
    (await api("POST", `${p}/issues/${iid}/commit`, { plan })).status,
  ).toBe(502);
  const after = await api<{ content: string }>(
    "GET",
    `${p}/file?path=app.py&version=current`,
  );
  expect(after.data.content).toBe(fixed.data.content);
});

test("ready のあとに話し続けると decide に戻り、plan_draft が消える", async () => {
  const { p } = await setup();
  let ready: Issue | undefined;
  for (const text of ["外から見えている", "B社が困る", "debugを切って直す"]) {
    ready = (await chat(p, "I1", { text })).data;
  }
  expect(ready?.phase).toBe("ready");
  expect(ready?.plan_draft).toBeTruthy();
  const back = (await chat(p, "I1", { text: "やっぱり" })).data;
  expect(back.phase).toBe("decide");
  expect(back.plan_draft).toBeUndefined();
  expect((await chat(p, "I1", {})).status).toBe(400);
});

test("見送ると escalate の出来事が増え、取り消すと消える", async () => {
  const { pid, p } = await setup();
  expect(
    (await api("POST", `${p}/issues/I1/skip`, { reason: "x" })).status,
  ).toBe(400);
  const r = await api("POST", `${p}/issues/I1/skip`, {
    reason: "今回は影響が小さい",
  });
  expect(r.status).toBe(200);
  const esc = r.data.issues.find((i) => i.escalated_from === "I1");
  expect(esc?.day).toBe(24);
  expect(r.data.issues.find((i) => i.id === "I1")?.skipped?.escalation_id).toBe(
    esc?.id,
  );
  expect(
    (await api<Lesson[]>("GET", "/api/lessons")).data.some(
      (l) => l.id === `${pid}-I1`,
    ),
  ).toBe(true);

  // 見送った結果の出来事(24日目)より先へは進めない
  const sim = await api<{ sim_day: number }>("POST", `${p}/sim`, { day: 999 });
  expect(sim.data.sim_day).toBe(24);

  const back = await api("POST", `${p}/issues/I1/unskip`);
  expect(back.data.issues.map((i) => i.id)).toEqual(["I1", "I2"]);
  expect(back.data.issues[0]?.skipped).toBeUndefined();
  expect(back.data.sim_day).toBe(10);
  expect(
    (await api<Lesson[]>("GET", "/api/lessons")).data.some(
      (l) => l.id === `${pid}-I1`,
    ),
  ).toBe(false);
});

test("再分析が AI の失敗で止まっても、前の会話は消えない", async () => {
  const { p } = await setup();
  await chat(p, "I1", { text: "デバッグ画面が外から見えている" });
  setAI(async () => {
    throw new AIError("失敗");
  });
  expect((await api("POST", `${p}/analyze`)).status).toBe(502);
  const after = await api<Payload>("GET", p);
  expect(after.data.issues.length).toBe(2);
  expect(after.data.issues[0]?.chat.length).toBeGreaterThan(1);
});

test("AIError は 502 と detail を返す", async () => {
  const { p } = await setup();
  setAI(async () => {
    throw new AIError("Claude Code が見つかりません");
  });
  const res = await api<{ detail: string }>("POST", `${p}/issues/I1/chat`, {
    hint: true,
  });
  expect(res.status).toBe(502);
  expect(res.data.detail).toBe("Claude Code が見つかりません");
  // 失敗した発言は保存されない
  const again = await api<Payload>("GET", p);
  expect(again.data.issues[0]?.chat).toEqual([]);
});
