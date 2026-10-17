import { cpSync, rmSync } from "node:fs";
import {
  archResultSchema,
  flowsAllResultSchema,
  flowsResultSchema,
  issuesResultSchema,
  SIM_DAYS,
} from "@tka/shared";
import { generate } from "./ai/client";
import {
  clampDay,
  cleanArchitecture,
  cleanFlows,
  cleanIfIgnored,
  uniqueDay,
} from "./clean";
import { prefetch } from "./detail";
import { parsePartialJson } from "./partial-json";
import { partialArchitecture, partialIssues } from "./partial-view";
import {
  endProgress,
  putPartial,
  setChars,
  setPartial,
  setStage as setProgressStage,
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
import { extractFeatures, readConfig, readSources } from "./scanner";
import type { Issue, Project } from "./types";

const STEPS = 5;

const setStage = (pid: string, step: number, stage: string) =>
  setProgressStage(pid, step, STEPS, stage);

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
  if (p.findings.length === 0) {
    reset(p);
    Object.assign(p, {
      issues: [],
      analyzed_by: "scanner",
      architecture: { nodes: [], edges: [] },
      sim_day: 0,
      dismissed: [],
      flows: [],
      uncovered_features: p.features.map((f) => f.id),
    });
    repo.saveProject(p);
    return projectPayload(p);
  }

  const src = srcDir(pid);
  setStage(pid, 2, "機能一覧を抜き出しています");
  const features = extractFeatures(src);
  // 4回の呼び出しで同じ system を使い、キャッシュを効かせる
  const system = analyzeSystem({
    bg: p.background,
    sources: readSources(src, 60_000, p.findings),
    config: readConfig(src),
  });

  setStage(pid, 3, "AIが構成図を考えています");
  // 先に単独で呼んで、キャッシュを作る
  const archRes = await generate({
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
  const arch = cleanArchitecture(archRes.architecture);

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
      onPartial: (json) =>
        setPartial(pid, () => ({
          architecture: arch,
          issues: partialIssues(parsePartialJson(json)),
        })),
      signal: ac.signal,
    }),
  ]).catch((e) => {
    ac.abort(); // 片方が失敗したら、もう片方も止める
    throw e;
  });

  const nodeIds = new Set(arch.nodes.map((n) => n.id));
  const featIds = new Set(features.map((f) => f.id));
  p.flows = cleanFlows(flowsRes.flows, arch, featIds);
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

  setStage(pid, 5, "結果を保存しています");
  const byId = new Map(p.findings.map((f) => [f.id, f]));
  // AIが誤検知として外した findings (同じ id は最初の1件だけ)
  p.dismissed = [];
  for (const d of result.dismissed) {
    if (
      byId.has(d.finding_id) &&
      !p.dismissed.some((x) => x.finding_id === d.finding_id)
    )
      p.dismissed.push(d);
  }
  const dismissedIds = new Set(p.dismissed.map((d) => d.finding_id));
  const raw = result.issues
    .map((it) => ({
      it,
      day: clampDay(it.day, SIM_DAYS),
      fids: it.finding_ids.filter((f) => byId.has(f) && !dismissedIds.has(f)),
    }))
    .filter((r) => r.fids.length > 0) // 根拠のない指摘は出さない
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
