import {
  type Background,
  type Feedback,
  type Issue,
  type Lesson,
  type Project,
  type SavedState,
  type Signal,
  type Skipped,
  savedStateSchema,
} from "@tka/shared";
import { useSyncExternalStore } from "react";
import { applyPatch, diffRows, PREVENTS } from "./patch";
import {
  INCIDENTS,
  RULES,
  SAMPLE_ARCH,
  SAMPLE_CODE,
  SAMPLE_FINDINGS,
} from "./sample-data";

// バックエンドを使わず、ブラウザの localStorage に保存する
const KEY = "judgineer:v1";

export const SIM_DAYS = 180;

const EMPTY: SavedState = { projects: [], lessons: [] };

function load(): SavedState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = savedStateSchema.safeParse(JSON.parse(raw));
    // 台本にないルールの出来事が混じったデータは使えない
    if (
      parsed.success &&
      parsed.data.projects.every((p) => p.issues.every((i) => i.rule in RULES))
    ) {
      return parsed.data;
    }
  } catch {
    // 壊れたデータは下で退避する
  }
  // 読めなかったデータは、次の保存で消えないよう別のキーに残しておく
  try {
    if (raw) localStorage.setItem(`${KEY}:backup`, raw);
  } catch {
    // 退避できなくても、空の状態で動かす
  }
  return EMPTY;
}

let state = load();
const listeners = new Set<() => void>();

function commit(next: SavedState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても、この画面の中では動かし続ける
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useStore = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );

/** 運用を先に進めてよい状態か（対応済み・修正で回避・見送り） */
export const isSettled = (i: Issue) =>
  !!(i.feedback || i.prevented_by || i.skipped);

export type IssueState = "avoided" | "done" | "skipped" | "open";

export const issueState = (i: Issue): IssueState =>
  i.prevented_by
    ? "avoided"
    : i.feedback
      ? "done"
      : i.skipped
        ? "skipped"
        : "open";

export const MIN_SKIP_REASON = 2;
export const MIN_STANCE = 5;
export const MIN_REASON = 5;

const now = () => new Date().toISOString();

/** 他のアプリで残したメモ。同じ種類の問題を先にして3件まで */
export function relatedLessons(lessons: Lesson[], p: Project): Lesson[] {
  const rules = new Set(p.issues.map((i) => i.rule));
  return lessons
    .filter((l) => l.project_id !== p.id)
    .sort((a, b) => Number(!rules.has(a.rule)) - Number(!rules.has(b.rule)))
    .slice(0, 3);
}

function getProject(pid: string) {
  const p = state.projects.find((x) => x.id === pid);
  if (!p) throw new Error("アプリが見つかりません");
  return p;
}

/** ここより先へは進めない日（最初の未対応の出来事の日） */
export const limitDay = (p: Project) =>
  Math.min(
    SIM_DAYS,
    ...p.issues.filter((i) => !isSettled(i)).map((i) => i.day),
  );

function mutate(pid: string, fn: (p: Project) => Project): Project {
  const changed = fn(getProject(pid));
  // 選び直しなどで未対応に戻った出来事より先に、日付が進んだままにならないようにする
  const next = {
    ...changed,
    sim_day: Math.min(changed.sim_day, limitDay(changed)),
  };
  commit({
    ...state,
    projects: state.projects.map((p) => (p.id === pid ? next : p)),
  });
  return next;
}

const findIssue = (p: Project, iid: string) => {
  const issue = p.issues.find((i) => i.id === iid);
  if (!issue) throw new Error("問題が見つかりません");
  return issue;
};

const patchIssue = (
  p: Project,
  iid: string,
  patch: Partial<Issue>,
): Project => ({
  ...p,
  issues: p.issues.map((i) => (i.id === iid ? { ...i, ...patch } : i)),
});

const nextIssueId = (p: Project) =>
  `I${Math.max(0, ...p.issues.map((i) => Number(i.id.slice(1)))) + 1}`;

export function createProject(background: Background): Project {
  const bg = { ...background, title: background.title.trim() };
  const issues: Issue[] = Object.entries(INCIDENTS)
    .sort(([, a], [, b]) => a.day - b.day)
    .map(([rule, inc], n) => {
      const t = RULES[rule];
      return {
        id: `I${n + 1}`,
        rule,
        day: inc.day,
        incident_title: inc.incident_title,
        incident_story: inc.incident_story,
        signals: inc.signals,
        view: inc.view,
        affected_nodes: inc.affected,
        title: t.title,
        category: t.category,
        severity: t.severity,
        what_happens: t.what_happens,
        who_is_affected: t.who,
        background_link: t.severity === "高" ? bg.constraints.slice(0, 80) : "",
        finding_ids: SAMPLE_FINDINGS.filter((f) => f.rule === rule).map(
          (f) => f.id,
        ),
        stance: "",
        options: [],
        unknowns: [],
        decision: null,
        feedback: null,
        fix: null,
        lesson: "",
      };
    });
  const project: Project = {
    id: crypto.randomUUID().slice(0, 8),
    created_at: now(),
    background: bg,
    findings: SAMPLE_FINDINGS,
    issues,
    architecture: SAMPLE_ARCH,
    source: SAMPLE_CODE,
    code: SAMPLE_CODE,
    sim_day: 0,
  };
  commit({ ...state, projects: [project, ...state.projects] });
  return project;
}

export function setSimDay(pid: string, day: number) {
  mutate(pid, (p) => ({
    ...p,
    sim_day: Math.max(0, Math.min(SIM_DAYS, Math.floor(day))),
  }));
}

const ESCALATION_SIGNALS: Signal[] = [
  {
    time: "09:12:40",
    source: "監視",
    level: "warn",
    text: "同じ種類のエラー・警告が先月の3倍に増加",
  },
  {
    time: "10:30:05",
    source: "問い合わせ",
    level: "error",
    text: "「前にも似たことがありましたよね？まだ直っていないんですか？」",
  },
  {
    time: "11:02:18",
    source: "社内チャット",
    level: "warn",
    text: "「これ、前に見送ったやつと同じ原因じゃない？」",
  },
];

/** 見送ったときの結果。重要度から決める */
function ifIgnored(issue: Issue): {
  impact: Skipped["impact"];
  reason: string;
} {
  if (issue.escalated_from) {
    return {
      impact: "none",
      reason:
        "一度見送った結果の出来事なので、ここから先の影響はシミュレーションしていません。",
    };
  }
  if (issue.severity === "低") {
    return {
      impact: "none",
      reason:
        "影響の範囲が小さく、放っておいても運用への影響は小さいと見込まれます。",
    };
  }
  return {
    impact: "escalate",
    reason:
      "原因が残ったままなので、時間がたつほど影響が広がると見込まれます。",
  };
}

function unskipIn(p: Project, iid: string): Project {
  const issue = findIssue(p, iid);
  if (!issue.skipped) return p;
  const esc = p.issues.find((o) => o.escalated_from === iid);
  if (esc && (esc.stance || esc.feedback || esc.skipped)) {
    throw new Error(
      `見送った結果として起きた${esc.day}日目の出来事にすでに対応しているため、見送りを取り消せません`,
    );
  }
  return {
    ...p,
    issues: p.issues
      .filter((o) => o.escalated_from !== iid)
      .map((o) => (o.id === iid ? { ...o, skipped: undefined } : o)),
  };
}

function removeLesson(id: string) {
  commit({ ...state, lessons: state.lessons.filter((l) => l.id !== id) });
}

function putLesson(lesson: Lesson) {
  commit({
    ...state,
    lessons: [lesson, ...state.lessons.filter((l) => l.id !== lesson.id)],
  });
}

export function skipIssue(pid: string, iid: string, reason: string) {
  const text = reason.trim();
  if (text.length < MIN_SKIP_REASON)
    throw new Error("見送る理由を一言書いてください");
  const cur = findIssue(getProject(pid), iid);
  if (cur.feedback) throw new Error("対応済みの出来事は見送れません");
  if (cur.prevented_by) throw new Error("この出来事は修正で回避されています");

  const p = mutate(pid, (proj) => {
    const base = unskipIn(proj, iid);
    const issue = findIssue(base, iid);
    const ii = ifIgnored(issue);
    const skipped: Skipped = {
      reason: text,
      impact: ii.impact,
      impact_reason: ii.reason,
    };
    if (ii.impact !== "escalate" || issue.day >= SIM_DAYS) {
      return patchIssue(base, iid, { skipped });
    }
    const used = new Set(base.issues.map((o) => o.day));
    let day = Math.max(
      issue.day + 1,
      Math.min(SIM_DAYS, issue.day + (issue.severity === "高" ? 21 : 35)),
    );
    while (used.has(day) && day < SIM_DAYS) day++;
    const who = issue.who_is_affected.split(/[（(、]/)[0].trim() || "利用者";
    const esc: Issue = {
      ...issue,
      id: nextIssueId(base),
      day,
      severity: "高",
      incident_title: `見送っていた問題が原因で、${who}への影響が広がっていることがわかった`,
      incident_story: `前に見送った「${issue.title}」は、その後も直されないまま運用が続いていた。気づいたときには、最初に見えていたときより影響が大きくなっていた。`,
      signals: ESCALATION_SIGNALS,
      escalated_from: iid,
      stance: "",
      options: [],
      unknowns: [],
      decision: null,
      feedback: null,
      fix: null,
      lesson: "",
      skipped: undefined,
    };
    const withSkip = patchIssue(base, iid, {
      skipped: { ...skipped, escalation_id: esc.id },
    });
    return {
      ...withSkip,
      issues: [...withSkip.issues, esc].sort((a, b) => a.day - b.day),
    };
  });

  putLesson({
    id: `${pid}-${iid}`,
    project_id: pid,
    issue_id: iid,
    project_title: p.background.title,
    issue_title: cur.title,
    rule: cur.rule,
    stance: "",
    chosen: "今回は対応しない（見送り）",
    reason: text,
    lesson: "",
    created_at: now(),
  });
}

export function unskipIssue(pid: string, iid: string) {
  mutate(pid, (p) => {
    const next = unskipIn(p, iid);
    return {
      ...next,
      sim_day: Math.min(next.sim_day, findIssue(next, iid).day),
    };
  });
  removeLesson(`${pid}-${iid}`);
}

/** 公開時のコードに、決めた順（日付順）で修正を当てたコード。excludeId の出来事の修正は除く */
function buildCode(p: Project, excludeId?: string): string {
  return [...p.issues]
    .sort((a, b) => a.day - b.day)
    .filter((i) => i.id !== excludeId && i.decision)
    .reduce((code, i) => applyPatch(code, i.rule), p.source);
}

function undoFix(p: Project, iid: string): Project {
  if (!findIssue(p, iid).fix) return p;
  return {
    ...p,
    code: buildCode(p, iid),
    issues: p.issues.map((o) => {
      if (o.id === iid) return { ...o, fix: null };
      return o.prevented_by === iid
        ? { ...o, prevented_by: undefined, prevented_reason: undefined }
        : o;
    }),
  };
}

export function submitStance(pid: string, iid: string, stance: string) {
  const text = stance.trim();
  if (text.length < MIN_STANCE)
    throw new Error("自分ならどうするかを、一言でもいいので書いてください");
  const mutated = mutate(pid, (proj) => {
    const base = undoFix(unskipIn(proj, iid), iid);
    const t = RULES[findIssue(base, iid).rule];
    return patchIssue(base, iid, {
      stance: text,
      options: t.options,
      unknowns: t.unknowns,
      decision: null,
      feedback: null,
      lesson: "",
    });
  });
  // 考え直した判断の記録とメモは、新しく決めるまで残さない
  removeLesson(`${pid}-${iid}`);
  return mutated;
}

const COVER_WORDS: [string, string][] = [
  ["B社", "提携先への影響"],
  ["契約", "契約"],
  ["手間", "実装の手間"],
  ["工数", "実装の手間"],
  ["人", "チームの体制"],
  ["漏", "情報漏洩のリスク"],
  ["早", "対応の早さ"],
  ["すぐ", "対応の早さ"],
];

function makeFeedback(
  bg: Background,
  chosen: Issue["options"][number],
  reason: string,
): Feedback {
  const covered = [
    ...new Set(
      COVER_WORDS.filter(([w]) => reason.includes(w)).map(([, label]) => label),
    ),
  ];
  const questions: string[] = [];
  if (!reason.includes("B社") && bg.constraints) {
    questions.push(
      `背景には「${bg.constraints.slice(0, 60)}…」とあります。この案を入れるとき、B社にはいつ、どう伝えますか？`,
    );
  }
  if (!reason.includes("人") && !reason.includes("体制") && bg.team) {
    questions.push(
      `「${bg.team}」という体制で、この案を入れたあとの運用を誰が担当しますか？`,
    );
  }
  if (bg.notes) {
    questions.push(
      `「${bg.notes.slice(0, 50)}」という予定があります。この判断は、その時にも同じで大丈夫ですか？`,
    );
  }
  questions.push(
    "この案を選んでも残る問題は何ですか？それはいつ、どう扱いますか？",
  );
  return {
    consequence: `${chosen.effects.security} ${chosen.effects.stakeholders}`,
    covered: covered.length
      ? covered
      : ["（理由から読み取れる観点が少なめです）"],
    questions: questions.slice(0, 3),
  };
}

/** 決めた案をコードに反映し、この先の出来事への影響を計算する */
function applyFix(p: Project, iid: string): Project {
  const issue = findIssue(p, iid);
  const idx = issue.decision?.option_index ?? 0;
  const chosen = issue.options[idx];
  const before = buildCode(p, iid);
  const after = applyPatch(before, issue.rule);
  const prevents = (PREVENTS[issue.rule] ?? []).filter(
    (x) => x.option_index === idx,
  );
  const future = p.issues.filter(
    (o) => o.id !== iid && o.day > issue.day && !isSettled(o),
  );
  const effects = future.map((o) => {
    const hit = prevents.find((x) => x.rule === o.rule);
    return {
      issue_id: o.id,
      effect: hit ? ("prevented" as const) : ("unchanged" as const),
      reason: hit?.reason ?? "この修正とは原因が別",
      day: o.day,
    };
  });
  const prevented = new Map(
    effects
      .filter((e) => e.effect === "prevented")
      .map((e) => [e.issue_id, e.reason]),
  );
  return {
    ...p,
    code: buildCode(p),
    issues: p.issues.map((o) => {
      if (o.id === iid) {
        const fix = {
          summary: `「${chosen.label}」を反映した。${chosen.change_summary}`,
          diffs:
            before === after
              ? []
              : [
                  {
                    file: "app.py",
                    notes: [chosen.label],
                    rows: diffRows(before, after),
                  },
                ],
          effects,
        };
        return { ...o, fix };
      }
      const reason = prevented.get(o.id);
      return reason ? { ...o, prevented_by: iid, prevented_reason: reason } : o;
    }),
  };
}

export function decide(
  pid: string,
  iid: string,
  optionIndex: number,
  reason: string,
) {
  const text = reason.trim();
  if (text.length < MIN_REASON) throw new Error("選んだ理由を書いてください");
  mutate(pid, (proj) => {
    const base = undoFix(proj, iid);
    const issue = findIssue(base, iid);
    const chosen = issue.options[optionIndex];
    if (!chosen) throw new Error("修正案を選んでください");
    const decided = patchIssue(base, iid, {
      decision: { option_index: optionIndex, reason: text },
      feedback: makeFeedback(base.background, chosen, text),
    });
    return applyFix(decided, iid);
  });
}

export function saveLesson(pid: string, iid: string, lesson: string) {
  const p = mutate(pid, (proj) => {
    if (!findIssue(proj, iid).decision)
      throw new Error("先に修正案を選んでください");
    return patchIssue(proj, iid, { lesson: lesson.trim() });
  });
  const issue = findIssue(p, iid);
  putLesson({
    id: `${pid}-${iid}`,
    project_id: pid,
    issue_id: iid,
    project_title: p.background.title,
    issue_title: issue.title,
    rule: issue.rule,
    stance: issue.stance,
    chosen: issue.options[issue.decision?.option_index ?? 0].label,
    reason: issue.decision?.reason ?? "",
    lesson: issue.lesson,
    created_at: now(),
  });
}
