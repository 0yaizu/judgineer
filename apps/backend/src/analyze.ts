import { cpSync, rmSync } from "node:fs";
import {
  archResultSchema,
  flowsAllResultSchema,
  flowsResultSchema,
  type IssueOutline,
  type IssuesResult,
  issuesResultSchema,
  SIM_DAYS,
} from "@tka/shared";
import { generate } from "./ai/client";
import {
  clampDay,
  cleanArchitecture,
  cleanFlows,
  cleanIfIgnored,
  fallbackOutline,
  uniqueDay,
} from "./clean";
import { prefetch } from "./detail";
import { extraFindings } from "./extra";
import { parsePartialJson } from "./partial-json";
import { partialArchitecture } from "./partial-view";
import {
  endProgress,
  putPartial,
  setChars,
  setPartial,
  setStage as setProgressStage,
  setProgressStats,
} from "./progress";
import { currentDir, loadProject, projectPayload, srcDir } from "./project";
import {
  analyzeSystem,
  archPrompt,
  flowsAllPrompt,
  flowsMissingPrompt,
  issuesPrompt,
} from "./prompts/analyze";
import * as repo from "./repo";
import {
  extractFeatures,
  readConfig,
  readSources,
  scannerFindings,
} from "./scanner";
import { codeInventory } from "./scanner-files";
import type { Issue, Project } from "./types";

const STEPS = 5;
const STEP_LABELS = [
  "検査結果を整理",
  "機能一覧を抽出",
  "構成図と追加観点を確認",
  "利用シナリオを準備",
  "シミュレーションを準備",
];

const setStage = (pid: string, step: number, stage: string) =>
  setProgressStage(pid, step, STEPS, stage, STEP_LABELS);

export async function analyze(pid: string) {
  setStage(pid, 1, "コードの指摘を整理しています");
  try {
    return await run(pid);
  } finally {
    endProgress(pid);
  }
}

/** 分析し直すとき用: 前の会話と修正を捨てて、登録時の状態に戻す */
function reset(p: Project): void {
  if (p.issues.length > 0) repo.saveProject({ ...p, issues: [] });
  rmSync(currentDir(p.id), { recursive: true, force: true });
  cpSync(srcDir(p.id), currentDir(p.id), { recursive: true });
}

async function run(pid: string) {
  const p = loadProject(pid);
  p.findings = scannerFindings(p.findings); // 前回の分析で入った AI 由来の分は捨てる
  const scannerFoundNothing = p.findings.length === 0;
  const src = srcDir(pid);
  setProgressStats(pid, codeInventory(src));
  setStage(pid, 2, "機能一覧を抜き出しています");
  const features = extractFeatures(src);
  // 4回の呼び出しで同じ system を使い、キャッシュを効かせる
  // AI の追加分が入ると system が変わってキャッシュが効かなくなるので、スキャナ由来だけで作る
  const system = analyzeSystem({
    bg: p.background,
    sources: readSources(src, 60_000, scannerFindings(p.findings)),
    config: readConfig(src),
  });

  setStage(pid, 3, "AIが構成図を考え、追加の指摘を探しています");
  setProgressStats(pid, { checksCompleted: 0, checksTotal: 2 });
  const findExtras = () =>
    extraFindings({
      root: src,
      system,
      existing: p.findings,
      onProgress: (checksCompleted, checksTotal) =>
        setProgressStats(pid, { checksCompleted, checksTotal }),
    });
  const makeArchitecture = () =>
    generate({
      task: "arch",
      system,
      prompt: archPrompt(),
      schema: archResultSchema,
      onPartial: (json) =>
        setPartial(pid, () => {
          const architecture = partialArchitecture(parsePartialJson(json));
          return architecture && { architecture };
        }),
    });

  // arch は findings に依存しないので、追加の指摘探しと並列に呼ぶ
  const [archRes, extras] = scannerFoundNothing
    ? [undefined, await findExtras()]
    : await Promise.all([makeArchitecture(), findExtras()]);
  p.findings.push(...extras);
  if (p.findings.length === 0) {
    reset(p);
    Object.assign(p, {
      issues: [],
      analyzed_by: "scanner",
      architecture: { nodes: [], edges: [] },
      sim_day: 0,
      dismissed: [],
      flows: [],
      features,
      uncovered_features: features.map((feature) => feature.id),
    });
    repo.saveProject(p);
    return projectPayload(p);
  }
  const architectureResult = archRes ?? (await makeArchitecture());
  const arch = cleanArchitecture(architectureResult.architecture);
  setProgressStats(pid, {
    checksCompleted: 2,
    nodes: arch.nodes.length,
    edges: arch.edges.length,
  });

  setStage(pid, 4, "AIが利用シナリオと台本を書いています");
  putPartial(pid, { architecture: arch });
  const ac = new AbortController();
  const counts = [0, 0];
  const onProgress = (i: number) => (n: number) => {
    counts[i] = n;
    const total = counts[0] + counts[1];
    setChars(
      pid,
      total,
      `AIが台本を書いています（${total.toLocaleString("en-US")}文字）`,
    );
  };
  const [flowsRes, result] = await Promise.all([
    generate({
      task: "flows_all",
      system,
      prompt: flowsAllPrompt({ arch, features }),
      schema: flowsAllResultSchema,
      onProgress: onProgress(0),
      signal: ac.signal,
    }),
    generate({
      task: "issues",
      system,
      prompt: issuesPrompt({ findings: p.findings, arch }),
      schema: issuesResultSchema,
      onProgress: onProgress(1),
      signal: ac.signal,
    }),
  ]).catch((e) => {
    ac.abort(); // 片方が失敗したら、もう片方も止める
    throw e;
  });

  const nodeIds = new Set(arch.nodes.map((n) => n.id));
  const featIds = new Set(features.map((f) => f.id));
  p.flows = cleanFlows(flowsRes.flows, arch, featIds);
  setProgressStats(pid, { flows: p.flows.length });
  // どの flow にも入らなかった機能だけ、AIに1回だけ追加で頼む
  const uncovered = () => {
    const covered = new Set(p.flows.flatMap((f) => f.feature_ids));
    return features.filter((f) => !covered.has(f.id));
  };
  const missing = uncovered();
  if (missing.length > 0 && arch.nodes.length > 0) {
    try {
      const extra = await generate({
        task: "flows",
        system,
        prompt: flowsMissingPrompt({ arch, missing }),
        schema: flowsResultSchema,
      });
      p.flows.push(...cleanFlows(extra.flows, arch, featIds));
    } catch {
      // 補完は失敗しても本体の分析は残す (残りは uncovered_features として画面に出る)
    }
  }
  p.features = features;
  p.uncovered_features = uncovered().map((f) => f.id);
  p.assumed_users = flowsRes.assumed_users;

  const byId = new Map(p.findings.map((f) => [f.id, f]));
  // 実在する finding を持つ issue だけ残す (根拠のない指摘は出さない)
  const kept: { it: IssueOutline; fids: string[] }[] = [];
  const issueIds = new Set<string>();
  const dismissedList: Project["dismissed"] = [];
  const dismissedIds = new Set<string>();
  const absorb = (res: IssuesResult, allowed: Set<string>) => {
    for (const it of res.issues) {
      const fids = it.finding_ids.filter((f) => allowed.has(f));
      if (fids.length === 0) continue;
      kept.push({ it, fids });
      for (const f of fids) issueIds.add(f);
    }
    // issue と dismissed が矛盾したら issue を優先する (本物を落とさない)
    for (const d of res.dismissed) {
      if (
        allowed.has(d.finding_id) &&
        !issueIds.has(d.finding_id) &&
        !dismissedIds.has(d.finding_id)
      ) {
        dismissedList.push(d);
        dismissedIds.add(d.finding_id);
      }
    }
  };
  absorb(result, new Set(byId.keys()));
  const unclassified = () =>
    p.findings.filter((f) => !issueIds.has(f.id) && !dismissedIds.has(f.id));
  // 分類漏れは1回だけ聞き直す。失敗はそのまま上に伝える
  const lost = unclassified();
  if (lost.length > 0) {
    setStage(pid, 4, "AIが分類漏れを確認しています");
    absorb(
      await generate({
        task: "issues_missing",
        system,
        prompt: issuesPrompt({ findings: lost, arch }),
        schema: issuesResultSchema,
      }),
      new Set(lost.map((f) => f.id)),
    );
  }
  // それでも漏れたものは機械で issue にする
  unclassified().forEach((f, i) => {
    kept.push({ it: fallbackOutline(f, i + 1), fids: [f.id] });
  });

  setStage(pid, 5, "結果を保存しています");
  p.dismissed = dismissedList;
  const raw = kept
    .map(({ it, fids }) => ({ it, day: clampDay(it.day, SIM_DAYS), fids }))
    .sort((a, b) => a.day - b.day);
  const used = new Set<number>();
  reset(p); // AI が全部成功してから捨てる (失敗したら前の状態を残す)
  p.issues = raw.map(({ it, day, fids }, n): Issue => {
    const d = uniqueDay(day, used, SIM_DAYS);
    used.add(d);
    const ii = cleanIfIgnored(it.if_ignored);
    return {
      id: `I${n + 1}`,
      day: d,
      chat: [],
      title: it.title,
      category: it.category,
      severity: it.severity,
      view: it.view,
      incident_title: it.incident_title,
      affected_nodes: it.affected_nodes.filter((a) => nodeIds.has(a)),
      // 本文は必要になったときに detail.ts で作る (空文字が未生成の印)
      incident_story: "",
      signals: [],
      what_happens: "",
      who_is_affected: "",
      background_link: "",
      finding_ids: fids,
      _rule: byId.get(fids[0] as string)?.rule,
      ...(ii ? { if_ignored: ii } : {}),
      stance: "",
      decision: null,
      feedback: null,
      lesson: "",
    };
  });
  p.analyzed_by = "claude_code";
  p.architecture = arch;
  p.sim_day = 0;
  repo.saveProject(p);
  void prefetch(pid); // 一番早い出来事の本文を先に作っておく
  return projectPayload(p);
}
