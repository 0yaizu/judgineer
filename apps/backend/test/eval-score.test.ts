import { describe, expect, test } from "bun:test";
import { aCompanyApi as golden } from "../eval/golden";
import { type Check, score, summarize } from "../eval/score";
import type { Issue, Project } from "../src/types";

const findings = golden.findings.map((g, i) => ({
  id: `F${i}`,
  rule: g.rule,
  title: g.by === "title" ? g.match : "t",
  file: "app.py",
  line: 5,
  snippet: `   4  x\n   5  ${g.by === "title" ? "y" : g.match}\n   6  z`,
}));

const signal = (time = "06:00:00") => ({
  time,
  source: "api",
  level: "warn" as const,
  text: "遅い",
});

const issue = (
  n: number,
  fids: string[],
  over: Partial<Issue> = {},
): Issue => ({
  id: `I${n}`,
  day: n,
  chat: [],
  title: "t",
  category: "c",
  severity: "高",
  what_happens: "w",
  who_is_affected: "u",
  background_link: "b",
  finding_ids: fids,
  incident_title: "出来事",
  incident_story: "",
  signals: [],
  view: "code",
  affected_nodes: ["api"],
  if_ignored: {
    impact: "none",
    reason: "r",
    after_days: 0,
    incident_title: "",
    incident_story: "",
    signals: [],
  },
  ...over,
});

// expect "issue" の7件 (F1,F2,F3,F4,F6,F8,F9) を1件ずつ issue に、either の3件 (F0, F5, F7) は見送り
const good = (): Project =>
  ({
    findings: [...findings],
    issues: [1, 2, 3, 4, 6, 8, 9].map((n, k) => issue(k + 1, [`F${n}`])),
    dismissed: [0, 5, 7]
      .map((n) => `F${n}`)
      .map((finding_id) => ({ finding_id, reason: "r" })),
    architecture: {
      nodes: [
        { id: "api", label: "API", kind: "internal" },
        { id: "db", label: "DB", kind: "db" },
        { id: "b", label: "B社", kind: "partner" },
      ],
      edges: [
        {
          from: "api",
          to: "db",
          label: "l",
          direction: "one",
          kind: "runtime",
        },
      ],
    },
    flows: [{ actor: "b", title: "f", per_day: 1, feature_ids: [], steps: [] }],
    uncovered_features: [],
  }) as unknown as Project;

const find = (cs: Check[], name: string) => cs.find((c) => c.name === name);

function broken(name: string, edit: (p: Project) => void) {
  const p = good();
  edit(p);
  return find(score(p, golden), name);
}

describe("score", () => {
  test("正しい Project は fail 0 / warn 0", () => {
    expect(summarize(score(good(), golden))).toEqual({ fail: 0, warn: 0 });
  });

  test("findings_match: 取りこぼし", () => {
    const c = broken("findings_match", (p) => {
      p.findings = p.findings.slice(1);
    });
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("fail");
  });

  test("all_accounted / not_dismissed: issue のものを見送りに入れる", () => {
    const p = good();
    p.issues = p.issues.filter((i) => i.finding_ids[0] !== "F1");
    p.dismissed.push({ finding_id: "F1", reason: "r" });
    const cs = score(p, golden);
    expect(find(cs, "all_accounted")?.ok).toBe(true);
    expect(find(cs, "not_dismissed")?.ok).toBe(false);
  });

  test("all_accounted: どこにも無い", () => {
    expect(broken("all_accounted", (p) => p.dismissed.pop())?.ok).toBe(false);
  });

  test("severity_floor: 下げる", () => {
    expect(
      broken("severity_floor", (p) => {
        p.issues[2].severity = "中"; // F3 は 高 が必要
      })?.ok,
    ).toBe(false);
  });

  test("severity_ceiling: either だけの issue が高なら warn", () => {
    const p = good();
    p.dismissed = p.dismissed.filter((d) => d.finding_id !== "F0");
    p.issues.push(issue(9, ["F0"]));
    const c = find(score(p, golden), "severity_ceiling");
    expect(c).toMatchObject({ ok: false, level: "warn" });
  });

  test("issue_integrity: day の重複 / 存在しない node", () => {
    expect(
      broken("issue_integrity", (p) => {
        p.issues[1].day = p.issues[0].day;
      })?.ok,
    ).toBe(false);
    expect(
      broken("issue_integrity", (p) => {
        p.issues[0].affected_nodes = ["nowhere"];
      })?.ok,
    ).toBe(false);
  });

  test("architecture: kind の欠落", () => {
    expect(
      broken("architecture", (p) => {
        p.architecture.nodes = p.architecture.nodes.filter(
          (n) => n.kind !== "db",
        );
      })?.ok,
    ).toBe(false);
  });

  test("flows: uncovered_features あり", () => {
    expect(
      broken("flows", (p) => {
        p.uncovered_features = ["f1"];
      })?.ok,
    ).toBe(false);
  });

  test("cause_leak: 本文に原因の名前が混ざると warn", () => {
    const c = broken("cause_leak", (p) => {
      p.issues[0].incident_story = "SQLインジェクションで漏れた";
    });
    expect(c).toMatchObject({ ok: false, level: "warn" });
  });

  test("detail_shape: 本文なしは ok、形が悪ければ fail", () => {
    expect(find(score(good(), golden), "detail_shape")?.ok).toBe(true);
    const ok = broken("detail_shape", (p) => {
      p.issues[0].incident_story = "あ".repeat(30);
      p.issues[0].signals = [signal(), signal(), signal()];
    });
    expect(ok?.ok).toBe(true);
    const bad = broken("detail_shape", (p) => {
      p.issues[0].incident_story = "あ".repeat(30);
      p.issues[0].signals = [signal("6:00")];
    });
    expect(bad?.ok).toBe(false);
  });
});
