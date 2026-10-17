import { expect, test } from "bun:test";
import type { Issue } from "../src/types";
import {
  api,
  findingIds,
  installFakeAI,
  overrides,
  type Payload,
  setup,
} from "./helpers/fake-ai";

installFakeAI();

// AI が見つけた指摘 (origin "ai") はスキャナで再確認できない
const CORS_LINE = 14;
const FIXED_CORS = 'CORS(app, origins="https://b-company.example")';

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

/** I1 (day 10) と I2 (day 40) の finding_ids を決めて分析する。"AI" は AI 由来の finding の id に置き換わる */
async function setupWith(i1: string[], i2: string[]) {
  overrides.set("extra_findings", () => ({
    candidates: [
      {
        title: "接続を閉じていない",
        file: "app.py",
        line: 1,
        quote: "conn = sqlite3.connect(DB_PATH)",
        why: "閉じ忘れで接続が溜まる",
      },
    ],
  }));
  overrides.set("issues", () => {
    const ai = `F${findingIds.length + 1}`;
    const sub = (ids: string[]) =>
      ids.map((id) => (id === "AI" ? ai : (findingIds[Number(id)] as string)));
    const used = new Set([...sub(i1), ...sub(i2)]);
    return {
      issues: [outline(10, "一つ目", sub(i1)), outline(40, "二つ目", sub(i2))],
      dismissed: [...findingIds, ai]
        .filter((id) => !used.has(id))
        .map((finding_id) => ({ finding_id, reason: "r" })),
    };
  });
  const s = await setup();
  const ai = s.project.findings.find((f) => f.origin === "ai");
  expect(ai).toBeDefined();
  expect(s.project.issues.map((i) => i.id)).toEqual(["I1", "I2"]);
  return { ...s, aiId: ai?.id as string };
}

function fakeApply(
  future: { issue_id: string; effect: string; reason: string }[] = [],
) {
  overrides.set("apply", () => ({
    summary: "直した",
    code_changes: [
      {
        file: "app.py",
        start_line: CORS_LINE,
        end_line: CORS_LINE,
        new_lines: [FIXED_CORS],
        note: "",
      },
    ],
    architecture_after: {
      nodes: [{ id: "api", label: "API", kind: "internal" }],
      edges: [],
    },
    arch_notes: [],
    future,
    new_incidents: [],
    reflection: "",
  }));
}

const commit = (p: string) =>
  api<{ issue: Issue; project: Payload }>("POST", `${p}/issues/I1/commit`, {
    plan: "CORS を B社のドメインだけに絞る",
  });

const lastFix = (i: Issue) =>
  i.chat.filter((m) => m.kind === "fix").at(-1)?.text ?? "";

test("先の出来事が AI 由来の指摘を持つとき、AI の prevented は上書きしない", async () => {
  const { p } = await setupWith(["0"], ["AI"]);
  fakeApply([{ issue_id: "I2", effect: "prevented", reason: "防げる" }]);
  const r = await commit(p);
  expect(r.status).toBe(200);
  const e = r.data.issue.fix?.effects.find((x) => x.issue_id === "I2");
  expect(e?.effect).toBe("prevented");
  expect(e?.reason).toBe("防げる");
  const i2 = r.data.project.issues.find((x) => x.id === "I2");
  expect(i2?.prevented_by).toBe("I1");
});

test("先の出来事に AI 由来が混じっていても、AI の判定を上書きしない", async () => {
  const { p } = await setupWith(["0"], ["1", "AI"]);
  fakeApply([{ issue_id: "I2", effect: "prevented", reason: "防げる" }]);
  const r = await commit(p);
  const e = r.data.issue.fix?.effects.find((x) => x.issue_id === "I2");
  expect(e?.effect).toBe("prevented");
});

test("自身の指摘にスキャナ由来と AI 由来があると、確かめた分だけ記録する", async () => {
  const { p, aiId } = await setupWith(["0", "AI"], ["1"]);
  fakeApply();
  const r = await commit(p);
  const v = r.data.issue.fix?.verification;
  expect(v?.resolved).toEqual([findingIds[0] as string]);
  expect(v?.remaining).toEqual([]);
  expect(v?.resolved).not.toContain(aiId);
  const text = lastFix(r.data.issue);
  expect(text).toContain("すべて解消");
  expect(text).toContain(
    "AI が見つけた指摘1件は、スキャナでは確かめられません",
  );
});

test("自身の指摘がすべて AI 由来だと、解消とも残りとも言わない", async () => {
  const { p } = await setupWith(["AI"], ["0"]);
  fakeApply();
  const r = await commit(p);
  const v = r.data.issue.fix?.verification;
  expect(v?.resolved).toEqual([]);
  expect(v?.remaining).toEqual([]);
  const text = lastFix(r.data.issue);
  expect(text).not.toContain("すべて解消");
  expect(text).not.toContain("残っています");
  expect(text).toContain("スキャナでは確かめられません");
});
