import { expect, test } from "bun:test";
import { ensureDetail, hasDetail } from "../src/detail";
import * as repo from "../src/repo";
import { api, calls, installFakeAI, setup } from "./helpers/fake-ai";

installFakeAI();

const detailCalls = () => calls.filter((c) => c.task === "detail").length;

test("analyze 直後は本文が空で、ensureDetail で埋まる", async () => {
  const { pid, project } = await setup();
  for (const i of project.issues) {
    expect(i.incident_story).toBe("");
    expect(i.signals).toEqual([]);
    expect(i.what_happens).toBe("");
    expect(hasDetail(i)).toBe(false);
  }
  await ensureDetail(pid, "I2");
  const i2 = repo.getProject(pid)?.issues.find((i) => i.id === "I2");
  expect(i2?.incident_story).toBe("朝6時に気づいた。");
  expect(i2?.signals.length).toBe(1);
  expect(i2?.what_happens).toContain("(生成)");
});

test("同時に2回呼んでも generate は1回、埋まっていれば呼ばない", async () => {
  const { pid } = await setup();
  await ensureDetail(pid, "I1"); // 先読みが走っていても終わらせる
  calls.length = 0;
  await Promise.all([ensureDetail(pid, "I2"), ensureDetail(pid, "I2")]);
  expect(detailCalls()).toBe(1);
  await ensureDetail(pid, "I2");
  expect(detailCalls()).toBe(1);
});

test("見送りで増えた出来事は what_happens を残して story と signals だけ更新", async () => {
  const { p } = await setup();
  const skip = await api("POST", `${p}/issues/I1/skip`, { reason: "後回し" });
  expect(skip.status).toBe(200);
  const esc = skip.data.issues.find((i) => i.escalated_from === "I1");
  expect(esc?.incident_story).toBe("");
  const parentWhat = skip.data.issues.find((i) => i.id === "I1")?.what_happens;
  expect(parentWhat).toContain("(生成)");

  const res = await api<{ incident_story: string; what_happens: string }>(
    "POST",
    `${p}/issues/${esc?.id}/detail`,
  );
  expect(res.status).toBe(200);
  expect(res.data.incident_story).toBe("さらに被害が増えた。");
  expect(res.data.what_happens).toBe(parentWhat as string);
});

test("detail ルート: 存在しない iid / pid は 404", async () => {
  const { p } = await setup();
  expect((await api("POST", `${p}/issues/I99/detail`)).status).toBe(404);
  expect(
    (await api("POST", "/api/projects/nope/issues/I1/detail")).status,
  ).toBe(404);
});
