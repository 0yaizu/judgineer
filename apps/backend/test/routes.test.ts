import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { apps } from "../src/db/schema";
import * as repo from "../src/repo";
import { registerTarget } from "../src/targets";
import { api, calls, installFakeAI, setup, TARGET } from "./helpers/fake-ai";

installFakeAI();

test("config", async () => {
  const cfg = await api<{ status: { ok: boolean } }>("GET", "/api/config");
  expect(cfg.data.status.ok).toBe(false); // CLAUDE_BIN は存在しない
});

test("targets: 一覧・登録・外す", async () => {
  const t = registerTarget(TARGET);
  const again = registerTarget(TARGET); // 同じフォルダは増えず、読み込んだ日時だけ更新
  expect(again.id).toBe(t.id);
  const list = await api<
    { id: string; exists: boolean; background: { title: string } }[]
  >("GET", "/api/targets");
  const mine = list.data.find((x) => x.id === t.id);
  expect(mine?.exists).toBe(true);
  expect(mine?.background.title).toContain("A社");
  expect(list.data.filter((x) => x.id === t.id).length).toBe(1);

  const other = registerTarget(mkdtempSync(join(tmpdir(), "tka-other-")));
  expect((await api("DELETE", `/api/targets/${other.id}`)).status).toBe(200);
  expect((await api("DELETE", `/api/targets/${other.id}`)).status).toBe(404);
});

test("targets: path の無いアプリは一覧に出ず、外せない。背景つきは外してもアプリが残る", async () => {
  const at = new Date().toISOString();
  db.insert(apps)
    .values({ id: "legacy", name: "旧アプリ", createdAt: at, updatedAt: at })
    .run();
  const list = await api<{ id: string }[]>("GET", "/api/targets");
  expect(list.data.some((x) => x.id === "legacy")).toBe(false);
  expect((await api("DELETE", "/api/targets/legacy")).status).toBe(404);

  const t = registerTarget(mkdtempSync(join(tmpdir(), "tka-bg-")));
  db.update(apps)
    .set({ background: { title: "登録済み" } as never })
    .where(eq(apps.id, t.id))
    .run();
  expect(repo.removeTarget(t.id)).toBe(true);
  const row = db.select().from(apps).where(eq(apps.id, t.id)).get();
  expect(row?.path).toBeNull();
  expect(row?.background).not.toBeNull();
});

test("targets: ホームと / は登録できない", () => {
  expect(() => registerTarget(homedir())).toThrow();
  expect(() => registerTarget("/")).toThrow();
  expect(() => registerTarget("/nonexistent-dir-xyz")).toThrow();
});

test("登録の入力検査", async () => {
  const t = registerTarget(TARGET);
  const bg = { title: "  " };
  expect(
    (await api("POST", "/api/projects", { target_id: t.id, background: bg }))
      .status,
  ).toBe(400);
  expect((await api("POST", "/api/projects", {})).status).toBe(400);
  // 一覧にないフォルダ
  expect(
    (
      await api("POST", "/api/projects", {
        target_id: "nope",
        background: { title: "x" },
      })
    ).status,
  ).toBe(404);
  expect((await api("GET", "/api/projects/nope")).status).toBe(404);
});

test("analyze: 7回の呼び出しで system が同じで、arch が先頭", async () => {
  const before = readdirSync(TARGET).sort();
  const { project } = await setup();
  expect(calls.map((c) => c.task).sort()).toEqual([
    "arch",
    "detail", // 一番早い出来事の本文の先読み
    "extra_findings", // arch と並列 (追加の指摘探し。観点ごとに2回)
    "extra_findings",
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
  expect(readdirSync(TARGET).sort()).toEqual(before);
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

test("apps: 読み込んだだけでは一覧に出ず、登録で載り、同じフォルダの再登録は背景を更新する", async () => {
  type AppList = { id: string; title: string }[];
  const dir = mkdtempSync(join(tmpdir(), "tka-app-"));
  writeFileSync(join(dir, "app.py"), "print('hi')\n");
  const t = registerTarget(dir);
  const before = (await api<AppList>("GET", "/api/apps")).data;
  expect(before.some((a) => a.id === t.id)).toBe(false);

  await api("POST", "/api/projects", {
    target_id: t.id,
    background: { title: "新アプリ" },
  });
  const created = (await api<AppList>("GET", "/api/apps")).data;
  expect(created.length).toBe(before.length + 1);
  expect(created.find((a) => a.id === t.id)?.title).toBe("新アプリ");

  await api("POST", "/api/projects", {
    target_id: t.id,
    background: { title: "新アプリ改", notes: "追記" },
  });
  const after = (await api<AppList>("GET", "/api/apps")).data;
  expect(after.length).toBe(created.length);
  const saved = await api<{ background: { title: string; notes: string } }>(
    "GET",
    `/api/apps/${t.id}`,
  );
  expect(saved.data.background.title).toBe("新アプリ改");
  expect(saved.data.background.notes).toBe("追記");
});

test("apps: 無い id は 404", async () => {
  expect((await api("GET", "/api/apps/nope")).status).toBe(404);
  expect(
    (
      await api("POST", "/api/projects", {
        target_id: "nope",
        background: { title: "x" },
      })
    ).status,
  ).toBe(404);
});

test("apps: 空文字の target_id は 404 で、id が空のアプリを作らない", async () => {
  const before = (await api<unknown[]>("GET", "/api/apps")).data.length;
  const res = await api("POST", "/api/projects", {
    target_id: "",
    background: { title: "x" },
  });
  expect(res.status).toBe(404);
  expect((await api<unknown[]>("GET", "/api/apps")).data.length).toBe(before);
});
