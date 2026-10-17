import { SIM_DAYS } from "@tka/shared";
import { type Finding, findingLine, scannerFindings } from "../src/scanner";
import type { Issue, Project } from "../src/types";
import type { Golden, GoldenFinding, KnownGap } from "./golden";

export type Check = {
  name: string;
  level: "fail" | "warn";
  ok: boolean;
  detail: string;
};

const RANK = { 低: 0, 中: 1, 高: 2 } as const;
const TIME = /^\d{2}:\d{2}:\d{2}$/;

const matches = (f: Finding, g: GoldenFinding) =>
  f.rule === g.rule &&
  (g.by === "title" ? f.title : findingLine(f)).includes(g.match);

/** finding.id → golden (1対1に対応づけられたものだけ) */
function pair(p: Project, golden: Golden) {
  const byId = new Map<string, GoldenFinding>();
  const missing: string[] = [];
  const free = [...p.findings];
  for (const g of golden.findings) {
    const i = free.findIndex((f) => matches(f, g));
    if (i < 0) {
      missing.push(`${g.rule}/${g.match}`);
      continue;
    }
    byId.set(free[i].id, g);
    free.splice(i, 1);
  }
  return { byId, missing, extra: free.map((f) => `${f.id}:${f.rule}`) };
}

export function score(p: Project, golden: Golden): Check[] {
  const checks: Check[] = [];
  const add = (
    name: string,
    level: Check["level"],
    problems: string[],
    ok = "ok",
  ) =>
    checks.push({
      name,
      level,
      ok: problems.length === 0,
      detail: problems.length === 0 ? ok : problems.join(" / "),
    });

  // AI の追加分は別のチェック (gaps_found / ai_extras) で見る
  const { byId, missing, extra } = pair(
    { ...p, findings: scannerFindings(p.findings) },
    golden,
  );
  add("findings_match", "fail", [
    ...(missing.length ? [`不足: ${missing.join(", ")}`] : []),
    ...(extra.length ? [`余り: ${extra.join(", ")}`] : []),
  ]);

  const inIssue = new Set(p.issues.flatMap((i) => i.finding_ids));
  const dismissed = new Set(p.dismissed.map((d) => d.finding_id));
  add(
    "all_accounted",
    "fail",
    p.findings
      .filter((f) => !inIssue.has(f.id) && !dismissed.has(f.id))
      .map((f) => `${f.id}:${f.rule}`),
  );

  const aiFound = p.findings.filter((f) => f.origin === "ai");
  const gaps = (golden.known_gaps ?? []).filter((g) => g.by_ai !== false);
  const hits = (g: KnownGap) =>
    aiFound.filter((f) => f.file === g.file && f.snippet.includes(g.match));
  const lostGaps = gaps.filter((g) => hits(g).length === 0);
  add(
    "gaps_found",
    "warn",
    lostGaps.length
      ? [
          `見つかった ${gaps.length - lostGaps.length} / ${gaps.length}（なし: ${lostGaps.map((g) => g.title).join("、")}）`,
        ]
      : [],
    `見つかった ${gaps.length} / ${gaps.length}`,
  );
  add(
    "ai_extras",
    "warn",
    aiFound
      .filter((f) => !gaps.some((g) => hits(g).includes(f)))
      .filter(
        (f) =>
          !(golden.accepted_extras ?? []).some(
            (x) => x.file === f.file && f.snippet.includes(x.match),
          ),
      )
      .map((f) => `${f.file}:${f.line} ${f.title}`),
    "なし",
  );

  const must = [...byId].filter(([, g]) => g.expect === "issue");
  add(
    "not_dismissed",
    "fail",
    must
      .filter(([id]) => !inIssue.has(id) || dismissed.has(id))
      .map(([id, g]) => `${id}:${g.rule}`),
  );

  const floor: string[] = [];
  for (const [id, g] of must) {
    if (!g.min_severity) continue;
    const sevs = p.issues
      .filter((i) => i.finding_ids.includes(id))
      .map((i) => i.severity);
    // 未対応(issue に無い)は not_dismissed が見る。ここでは入っているものだけ
    if (
      sevs.length &&
      !sevs.some((s) => RANK[s] >= RANK[g.min_severity ?? "低"])
    )
      floor.push(
        `${id}:${g.rule} は ${sevs.join("/")} (${g.min_severity}以上が必要)`,
      );
  }
  add("severity_floor", "fail", floor);

  const ceiling = p.issues
    .filter(
      (i) =>
        i.severity === "高" &&
        i.finding_ids.length > 0 &&
        i.finding_ids.every((id) => byId.get(id)?.expect === "either"),
    )
    .map((i) => `${i.id} ${i.title}`);
  add("severity_ceiling", "warn", ceiling);

  add("issue_integrity", "fail", integrity(p));

  const nodeIds = new Set(p.architecture.nodes.map((n) => n.id));
  const arch: string[] = [];
  for (const k of golden.arch.kinds)
    if (!p.architecture.nodes.some((n) => n.kind === k))
      arch.push(`kind ${k} の node が無い`);
  for (const e of p.architecture.edges)
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to))
      arch.push(`edge ${e.from}->${e.to} の端が存在しない`);
  add("architecture", "fail", arch);

  add("flows", "fail", [
    ...(p.uncovered_features.length
      ? [`uncovered_features: ${p.uncovered_features.join(", ")}`]
      : []),
    ...(p.flows.length === 0 ? ["flows が空"] : []),
  ]);

  const leaks: string[] = [];
  for (const i of p.issues) {
    if (i.incident_story === "") continue;
    const text = [
      i.incident_title,
      i.incident_story,
      ...i.signals.map((s) => s.text),
    ];
    const hit = golden.cause_words.filter((w) =>
      text.some((t) => t.includes(w)),
    );
    if (hit.length) leaks.push(`${i.id}: ${hit.join(",")}`);
  }
  add("cause_leak", "warn", leaks);

  const withBody = p.issues.filter((i) => i.incident_story !== "");
  if (withBody.length === 0)
    checks.push({
      name: "detail_shape",
      level: "fail",
      ok: true,
      detail: "本文なし(--detail なし)",
    });
  else add("detail_shape", "fail", withBody.flatMap(detailProblems));

  return checks;
}

function integrity(p: Project): string[] {
  const out: string[] = [];
  const findingIds = new Set(p.findings.map((f) => f.id));
  const dismissed = new Set(p.dismissed.map((d) => d.finding_id));
  const nodeIds = new Set(p.architecture.nodes.map((n) => n.id));
  let prev = 0;
  for (const i of p.issues) {
    const bad = (m: string) => out.push(`${i.id}: ${m}`);
    if (!Number.isInteger(i.day) || i.day < 1 || i.day > SIM_DAYS)
      bad(`day=${i.day} が範囲外`);
    else if (i.day <= prev) bad(`day=${i.day} が昇順でない/重複`);
    else prev = i.day;
    if (i.finding_ids.length === 0) bad("finding_ids が空");
    for (const id of i.finding_ids) {
      if (!findingIds.has(id)) bad(`finding ${id} が存在しない`);
      if (dismissed.has(id)) bad(`finding ${id} が dismissed と重なる`);
    }
    for (const a of i.affected_nodes)
      if (!nodeIds.has(a)) bad(`affected_nodes ${a} が存在しない`);
    if (!i.incident_title.trim()) bad("incident_title が空");
    const ig = i.if_ignored;
    if (!ig || (ig.impact !== "none" && ig.impact !== "escalate"))
      bad("if_ignored が不正");
    else if (ig.impact === "escalate") {
      if (!(ig.after_days >= 7 && ig.after_days <= 90))
        bad(`after_days=${ig.after_days} が 7〜90 でない`);
      if (!ig.incident_title.trim()) bad("if_ignored.incident_title が空");
    }
  }
  return out;
}

function detailProblems(i: Issue): string[] {
  const out: string[] = [];
  const bad = (m: string) => out.push(`${i.id}: ${m}`);
  if (i.incident_story.length < 20) bad("incident_story が20字未満");
  if (i.signals.length < 3 || i.signals.length > 6)
    bad(`signals が${i.signals.length}件 (3〜6件)`);
  for (const s of i.signals) {
    if (!TIME.test(s.time)) bad(`time ${s.time} の形式が違う`);
    if (!["info", "warn", "error"].includes(s.level)) bad(`level ${s.level}`);
  }
  if (!i.what_happens.trim()) bad("what_happens が空");
  if (!i.who_is_affected.trim()) bad("who_is_affected が空");
  return out;
}

export const summarize = (checks: Check[]) => ({
  fail: checks.filter((c) => !c.ok && c.level === "fail").length,
  warn: checks.filter((c) => !c.ok && c.level === "warn").length,
});
