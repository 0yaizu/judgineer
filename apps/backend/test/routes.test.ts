import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { config } from "../src/config";
import { api, calls, installFakeAI, setup } from "./helpers/fake-ai";

installFakeAI();

test("config / target", async () => {
  const cfg = await api<{
    status: { ok: boolean };
    target: { exists: boolean };
  }>("GET", "/api/config");
  expect(cfg.data.status.ok).toBe(false); // CLAUDE_BIN は存在しない
  expect(cfg.data.target.exists).toBe(true);
  const t = await api<{ exists: boolean; background: { title: string } }>(
    "GET",
    "/api/target",
  );
  expect(t.data.exists).toBe(true);
  expect(t.data.background.title).toContain("A社");
});

test("登録の入力検査", async () => {
  expect(
    (await api("POST", "/api/projects", { background: { title: "  " } }))
      .status,
  ).toBe(400);
  expect((await api("POST", "/api/projects", {})).status).toBe(400);
  expect((await api("GET", "/api/projects/nope")).status).toBe(404);
});

test("analyze: 4回の呼び出しで system が同じで、arch が先頭", async () => {
  const before = readdirSync(config.targetDir).sort();
  const { project } = await setup();
  expect(calls.map((c) => c.task).sort()).toEqual([
    "arch",
    "flows",
    "flows_all",
    "issues",
  ]);
  expect(calls[0]?.task).toBe("arch");
  expect(new Set(calls.map((c) => c.system)).size).toBe(1);

  expect(project.architecture.nodes.length).toBe(3);
  expect(project.assumed_users).toBe(30);
  expect(project.flows.length).toBe(2);
  expect(project.analyzed_by).toBe("claude_code");
  // 根拠のない指摘は捨て、day の順に並べて I1.. を振る
  expect(project.issues.map((i) => [i.id, i.day, i.title])).toEqual([
    ["I1", 10, "一つ目"],
    ["I2", 40, "二つ目"],
  ]);
  expect(project.issues[0]?.affected_nodes).toEqual(["api"]);
  expect(project.sim_days).toBe(180);
  expect(readdirSync(config.targetDir).sort()).toEqual(before);
});

test("file: パストラバーサルを拒否する", async () => {
  const { p } = await setup();
  for (const [version, sibling] of [
    ["original", "current"],
    ["current", "src"],
  ]) {
    for (const path of [
      `../${sibling}/app.py`, // もう一方のコピー
      "../../projects",
      "../../app.db",
      "/etc/passwd",
      "nothing.txt",
      "",
    ]) {
      const res = await api<{ detail: string }>(
        "GET",
        `${p}/file?path=${encodeURIComponent(path)}&version=${version}`,
      );
      expect(res.status).toBe(404);
    }
  }
});

test("apps: 新規登録で増え、app_id つきの登録は同じアプリの背景を更新する", async () => {
  type AppList = { id: string; title: string }[];
  const before = (await api<AppList>("GET", "/api/apps")).data;

  await api("POST", "/api/projects", { background: { title: "新アプリ" } });
  const created = (await api<AppList>("GET", "/api/apps")).data;
  expect(created.length).toBe(before.length + 1);
  const id = created.find((a) => a.title === "新アプリ")?.id ?? "";
  expect(id).not.toBe("");

  await api("POST", "/api/projects", {
    background: { title: "新アプリ改", notes: "追記" },
    app_id: id,
  });
  const after = (await api<AppList>("GET", "/api/apps")).data;
  expect(after.length).toBe(created.length);
  const saved = await api<{ background: { title: string; notes: string } }>(
    "GET",
    `/api/apps/${id}`,
  );
  expect(saved.data.background.title).toBe("新アプリ改");
  expect(saved.data.background.notes).toBe("追記");
});

test("apps: 無い id は 404", async () => {
  expect((await api("GET", "/api/apps/nope")).status).toBe(404);
  expect(
    (
      await api("POST", "/api/projects", {
        background: { title: "x" },
        app_id: "nope",
      })
    ).status,
  ).toBe(404);
});
