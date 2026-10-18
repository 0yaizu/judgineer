import { cpSync, existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type Background, type Incident, SIM_DAYS } from "@tka/shared";
import { cleanSignals } from "./clean";
import { config, REPO_ROOT } from "./config";
import { HttpError } from "./http";
import * as repo from "./repo";
import { extractFeatures, scan, snapshotTarget } from "./scanner";
import type { Issue, Lesson, Project } from "./types";

const projectDir = (pid: string) => join(config.dataDir, "projects", pid);
/** 登録時のコピー (元の状態) */
export const srcDir = (pid: string) => join(projectDir(pid), "src");
/** 修正を入れていく作業コピー。元のファイルや src は変えない */
export const currentDir = (pid: string) => join(projectDir(pid), "current");

/** root の中のファイルだけを返す (区切り文字つきで検査し、/root-evil のような兄弟も弾く) */
export function inside(root: string, rel: string): string | null {
  const r = resolve(root);
  const f = resolve(r, rel);
  return f.startsWith(r + sep) ? f : null;
}

export const isFile = (path: string) =>
  existsSync(path) && statSync(path).isFile();

/** 検査対象を取り込んで、分析前のプロジェクトを作って保存する */
export function createProject(bg: Background, root: string): Project {
  const id = repo.newId();
  const src = srcDir(id);
  // dataDir が検査対象の中にあっても、コピーが自分自身を取り込まないようにする
  snapshotTarget(root, src, [REPO_ROOT, config.dataDir]);
  cpSync(src, currentDir(id), { recursive: true });
  const project: Project = {
    id,
    created_at: repo.now(),
    background: bg,
    source: "target",
    findings: scan(src),
    features: extractFeatures(src),
    issues: [],
    architecture: { nodes: [], edges: [] },
    flows: [],
    dismissed: [],
    uncovered_features: [],
    assumed_users: null,
    sim_day: 0,
    analyzed_by: null,
  };
  repo.saveProject(project);
  return project;
}

export function loadProject(pid: string): Project {
  const p = repo.getProject(pid);
  if (!p) throw new HttpError(404, "プロジェクトが見つかりません");
  return p;
}

export function findIssue(p: Project, iid: string): Issue {
  const issue = p.issues.find((i) => i.id === iid);
  if (!issue) throw new HttpError(404, "問題が見つかりません");
  return issue;
}

export function nextIssueId(p: Project): string {
  const nums = p.issues.map((i) => Number(i.id.slice(1)));
  return `I${Math.max(0, ...nums.filter(Number.isInteger)) + 1}`;
}

/** AI が作った出来事から、保存する項目を取り出す (affected_nodes は構成図にあるものだけ) */
export function incidentFields(
  it: Omit<Incident, "day">,
  nodeIds: Set<string>,
) {
  return {
    title: it.title,
    category: it.category,
    severity: it.severity,
    what_happens: it.what_happens,
    who_is_affected: it.who_is_affected,
    background_link: it.background_link,
    incident_title: it.incident_title,
    incident_story: it.incident_story,
    view: it.view,
    signals: cleanSignals(it.signals),
    affected_nodes: it.affected_nodes.filter((a) => nodeIds.has(a)),
  };
}

// 同じ種類の問題を先にして、前の人のメモを5件まで
function relatedLessons(p: Project): Lesson[] {
  const rules = new Set(p.issues.map((i) => i._rule));
  return repo
    .listLessons()
    .filter((l) => l.project_id !== p.id)
    .sort(
      (a, b) =>
        Number(!rules.has(a.rule ?? "")) - Number(!rules.has(b.rule ?? "")),
    )
    .slice(0, 5);
}

export const projectPayload = (p: Project) => ({
  ...p,
  sim_days: SIM_DAYS,
  related_lessons: relatedLessons(p),
});

export const chosenOf = (issue: Issue) =>
  issue.chosen ?? { label: "（不明）", change_summary: "" };

export function saveLesson(p: Project, issue: Issue): void {
  repo.addLesson({
    id: `${p.id}-${issue.id}`,
    project_id: p.id,
    project_title: p.background.title,
    issue_title: issue.title,
    rule: issue._rule ?? null,
    category: issue.category,
    stance: issue.stance ?? "",
    chosen: chosenOf(issue).label,
    reason: issue.decision?.reason ?? "",
    lesson: issue.lesson ?? "",
    created_at: repo.now(),
  });
}

/** 見送りを取り消す。見送った結果として足した出来事も消す */
export function unskip(p: Project, issue: Issue): void {
  if (!issue.skipped) return;
  const esc = p.issues.find((o) => o.escalated_from === issue.id);
  if (esc && (esc.stance || esc.feedback || esc.skipped)) {
    throw new HttpError(
      400,
      `見送った結果として起きた${esc.day}日目の出来事にすでに対応しているため、見送りを取り消せません`,
    );
  }
  p.issues = p.issues.filter((o) => o.escalated_from !== issue.id);
  delete issue.skipped;
  repo.removeLesson(`${p.id}-${issue.id}`);
}
