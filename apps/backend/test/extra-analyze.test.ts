import { expect, test } from "bun:test";
import { ensureDetail } from "../src/detail";
import * as repo from "../src/repo";
import {
  api,
  calls,
  findingIds,
  installFakeAI,
  overrides,
  setup,
} from "./helpers/fake-ai";

installFakeAI();

const REAL = "conn = sqlite3.connect(DB_PATH)";
const cand = (quote: string, title: string) => ({
  title,
  file: "app.py",
  line: 1, // 実際の行とは違ってよい (最寄りの実在する行に直る)
  quote,
  why: "閉じ忘れで接続が溜まる",
});
const extras = () => ({
  candidates: [
    cand(REAL, "接続を閉じていない"),
    cand("conn.close_everything_at_exit()", "作り話"),
  ],
});
const ifIgnored = {
  impact: "none" as const,
  reason: "",
  after_days: 0,
  incident_title: "",
};
const outline = (day: number, title: string, finding_ids: string[]) => ({
  finding_ids,
  day,
  incident_title: `${title}の連絡が来た`,
  view: "code" as const,
  affected_nodes: [],
  title,
  category: "運用" as const,
  severity: "中" as const,
  if_ignored: ifIgnored,
});
// 既存の findings の1件目と、AI 由来の finding を issue にして、残りは dismissed
const classify = () => {
  const aiId = `F${findingIds.length + 1}`;
  return {
    issues: [
      outline(10, "一つ目", [findingIds[0] as string]),
      outline(20, "AI由来", [aiId]),
    ],
    dismissed: findingIds
      .slice(1)
      .map((finding_id) => ({ finding_id, reason: "r" })),
  };
};

test("実在する引用だけが findings に加わり、分類される", async () => {
  overrides.set("extra_findings", extras);
  overrides.set("issues", classify);
  const { pid, project } = await setup();
  const ai = project.findings.filter((f) => f.origin === "ai");
  expect(ai.length).toBe(1);
  expect(ai[0]?.id).toBe(`F${findingIds.length + 1}`);
  expect(ai[0]?.snippet).toContain(REAL);
  expect(project.findings.length).toBe(findingIds.length + 1);
  const classified = new Set([
    ...project.issues.flatMap((i) => i.finding_ids),
    ...project.dismissed.map((d) => d.finding_id),
  ]);
  expect(classified.has(ai[0]?.id as string)).toBe(true);
  expect(repo.getProject(pid)?.findings.length).toBe(project.findings.length);
});

test("追加の指摘探しが失敗しても分析は成功する", async () => {
  overrides.set("extra_findings", () => {
    throw new Error("boom");
  });
  const { project } = await setup();
  expect(project.findings.filter((f) => f.origin === "ai").length).toBe(0);
  expect(project.issues.length).toBe(2);
});

test("再分析しても AI 由来の findings が重複して増えない", async () => {
  overrides.set("extra_findings", extras);
  overrides.set("issues", classify);
  const { p } = await setup();
  const again = await api("POST", `${p}/analyze`);
  expect(again.status).toBe(200);
  expect(again.data.findings.filter((f) => f.origin === "ai").length).toBe(1);
  expect(again.data.findings.length).toBe(findingIds.length + 1);
});

test("すべての呼び出しで system が同じ (キャッシュが効く)", async () => {
  overrides.set("extra_findings", extras);
  overrides.set("issues", classify);
  const { pid, project } = await setup();
  // 先読みされていない出来事の本文も作る
  for (const i of project.issues) await ensureDetail(pid, i.id);
  const tasks = new Set(calls.map((c) => c.task));
  for (const t of ["arch", "extra_findings", "issues", "detail"])
    expect(tasks.has(t)).toBe(true);
  expect(new Set(calls.map((c) => c.system)).size).toBe(1);
});
