import { readFileSync, writeFileSync } from "node:fs";
import { applyResultSchema, SIM_DAYS } from "@tka/shared";
import { generate } from "./ai/client";
import { clampDay, cleanArchitecture, settled, uniqueDay } from "./clean";
import { diffRows, splitLines } from "./diff";
import { HttpError } from "./http";
import {
  chosenOf,
  currentDir,
  incidentFields,
  inside,
  isFile,
  nextIssueId,
} from "./project";
import { applyPrompt, applySystem } from "./prompts/apply";
import { readSources, relocate, scan } from "./scanner";
import { checkSyntax, syntaxCheckable } from "./syntax";
import type { Effect, Fix, Issue, Project } from "./types";
import { verifyFix } from "./verify";

/** 選び直したときに、前の修正の影響を元に戻す */
export function undoFix(p: Project, issue: Issue): void {
  const fix = issue.fix;
  if (!fix) return;
  const cur = currentDir(p.id);
  for (const [file, content] of Object.entries(fix.before_files)) {
    const target = inside(cur, file);
    if (target) writeFileSync(target, content);
  }
  p.architecture = fix.arch_before;
  for (const o of p.issues) {
    if (o.prevented_by === issue.id) {
      delete o.prevented_by;
      delete o.prevented_reason;
    }
    if (o.changed_by?.issue_id === issue.id) delete o.changed_by;
  }
  p.issues = p.issues.filter((o) => !(o.caused_by === issue.id && !o.feedback));
  issue.fix = null;
}

/** 決めた方針を current/ のコードと構成図に反映する。保存は呼び出し側 */
export async function applyFix(p: Project, issue: Issue): Promise<void> {
  if (!issue.decision) throw new HttpError(400, "先に修正案を選んでください");
  const cur = currentDir(p.id);
  // undoFix は AI に元のコードを見せるために先にファイルを戻す。失敗したら DB の状態 (前の修正あり) に合わせて戻す
  const applied: Record<string, string> = {};
  for (const file of Object.keys(issue.fix?.before_files ?? {})) {
    const t = inside(cur, file);
    if (t && isFile(t)) applied[file] = readFileSync(t, "utf8");
  }
  undoFix(p, issue);
  const chosen = chosenOf(issue);
  const evidence = p.findings.filter((f) => issue.finding_ids.includes(f.id));
  const future = p.issues
    .filter((o) => o.id !== issue.id && o.day > issue.day && !settled(o))
    .sort((a, b) => a.day - b.day);
  const archBefore = p.architecture;
  let result: Awaited<ReturnType<typeof generate<typeof applyResultSchema>>>;
  try {
    result = await generate({
      task: "apply",
      system: applySystem({
        bg: p.background,
        sources: readSources(cur, 60_000, relocate(cur, evidence)),
        arch: archBefore,
      }),
      prompt: applyPrompt({
        issue,
        chosen,
        reason: issue.decision.reason,
        future,
      }),
      schema: applyResultSchema,
    });
  } catch (e) {
    for (const [file, content] of Object.entries(applied)) {
      const t = inside(cur, file);
      if (t) writeFileSync(t, content);
    }
    throw e;
  }

  // コードの変更を反映する (後ろの行から置き換えて、行番号がずれないようにする)
  const byFile = new Map<string, typeof result.code_changes>();
  for (const c of result.code_changes) {
    byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  }
  const beforeFiles: Record<string, string> = {};
  const diffs = [];
  const newContent: Record<string, string> = {};
  const targets: Record<string, string> = {};
  // 1) 変更後の内容をメモリ上で作る (まだ書き込まない)
  for (const [file, changes] of byFile) {
    const target = inside(cur, file); // current/ の外は書き換えない
    if (!target || !isFile(target)) continue;
    const before = readFileSync(target, "utf8");
    const lines = splitLines(before);
    const notes: string[] = [];
    let changed = false;
    let lastStart = lines.length + 2;
    for (const c of [...changes].sort((a, b) => b.start_line - a.start_line)) {
      const s = c.start_line;
      const e = c.end_line;
      // 範囲外・直前に適用した変更と重なるものは捨てる
      if (s > lines.length + 1 || s - 1 > e || e > lines.length) continue;
      if (e >= lastStart) continue;
      lines.splice(s - 1, e - (s - 1), ...c.new_lines);
      lastStart = s;
      changed = true;
      if (c.note) notes.push(c.note);
    }
    if (!changed) continue;
    const after = lines.join("\n") + (before.endsWith("\n") ? "\n" : "");
    newContent[file] = after;
    targets[file] = target;
    beforeFiles[file] = before;
    diffs.push({
      file,
      notes: notes.reverse(),
      rows: diffRows(before, after),
    });
  }

  // 2) 構文チェック。1つでもエラーなら何も書かずに元へ戻して弾く
  let syntax: "ok" | "skipped" = "skipped";
  for (const [file, content] of Object.entries(newContent)) {
    const err = await checkSyntax(file, content);
    if (err) {
      for (const [f, c] of Object.entries(applied)) {
        const t = inside(cur, f);
        if (t) writeFileSync(t, c);
      }
      throw new HttpError(
        422,
        `AI が作った修正に構文エラーがありました（${file}: ${err}）。もう一度反映を試してください`,
      );
    }
    if (syntaxCheckable(file)) syntax = "ok";
  }

  // 3) 書き込み、前後を再スキャンして比べる
  const scanBefore = scan(cur);
  for (const [file, content] of Object.entries(newContent)) {
    writeFileSync(targets[file], content);
  }
  const v = verifyFix(p.findings, scanBefore, scan(cur));

  let archAfter = cleanArchitecture(result.architecture_after);
  if (archAfter.nodes.length === 0) archAfter = archBefore;
  p.architecture = archAfter;

  // この先の出来事への影響
  const effects: Effect[] = [];
  const aiSays = new Map(result.future.map((e) => [e.issue_id, e]));
  // 再スキャンで確かめられるものはスキャナの結果を優先し、AI の自己申告は確かめられないときだけ使う
  for (const o of future) {
    const ai = aiSays.get(o.id);
    let effect = ai?.effect;
    let reason = ai?.reason ?? "";
    const ids = o.finding_ids;
    if (ids.length > 0) {
      const done = ids.filter((id) => v.resolvedIds.has(id)).length;
      if (done === ids.length) {
        effect = "prevented";
        reason ||=
          "自動チェック: 該当する箇所が修正後のコードから無くなりました";
      } else if (effect === "prevented") {
        effect = done > 0 ? "reduced" : "unchanged";
        reason = `自動チェック: 該当箇所が残っていたため判定を直しました。${reason}`;
      }
    }
    if (!effect) continue;
    effects.push({ issue_id: o.id, effect, reason, day: o.day });
    if (effect === "prevented") {
      o.prevented_by = issue.id;
      o.prevented_reason = reason;
    } else if (effect === "reduced" || effect === "worse") {
      o.changed_by = { issue_id: issue.id, effect, reason };
    }
  }

  // 自動チェックの結果
  const where = (f: { file: string; line: number }) =>
    `${f.file} ${f.line}行目`;
  const ownResolved = evidence
    .filter((f) => v.resolvedIds.has(f.id))
    .map((f) => f.id);
  const ownRemaining = evidence.filter((f) => !v.resolvedIds.has(f.id));
  const verification: NonNullable<Fix["verification"]> = {
    resolved: ownResolved,
    remaining: ownRemaining.map((f) => f.id),
    introduced: v.introduced.map(({ rule, title, file, line }) => ({
      rule,
      title,
      file,
      line,
    })),
    syntax,
  };
  const list = (xs: string[]) =>
    xs.slice(0, 5).join("、") +
    (xs.length > 5 ? `、ほか${xs.length - 5}件` : "");
  const total = ownResolved.length + ownRemaining.length;
  const checkParts: string[] = [];
  if (total === 0) {
    // この出来事の指摘がすべて AI 由来のときは、確かめられた件数は無い
  } else if (ownRemaining.length === 0) {
    checkParts.push(`この出来事の指摘${total}件はすべて解消。`);
  } else {
    checkParts.push(
      `この出来事の指摘${total}件のうち${ownResolved.length}件が解消、${ownRemaining.length}件が残っています（${list(
        ownRemaining.map((f) => `${where(f)}付近: ${f.title}`),
      )}）。`,
    );
  }
  checkParts.push(
    v.introduced.length === 0
      ? "新しい指摘はありません。"
      : `この修正で新しく見つかった指摘: ${list(
          v.introduced.map((f) => `${where(f)}: ${f.title}`),
        )}。`,
  );
  if (syntax === "ok") checkParts.push("構文: 問題なし。");

  // 修正が原因で新しく起きる出来事 (1件まで)
  const newIds: string[] = [];
  const nodeIds = new Set(archAfter.nodes.map((n) => n.id));
  for (const it of result.new_incidents.slice(0, 1)) {
    const day = uniqueDay(
      Math.max(issue.day + 1, clampDay(it.day, SIM_DAYS)),
      p.issues.map((o) => o.day),
      SIM_DAYS,
    );
    const created: Issue = {
      id: nextIssueId(p),
      day,
      chat: [],
      ...incidentFields(it, nodeIds),
      finding_ids: [],
      _rule: "side-effect",
      caused_by: issue.id,
      stance: "",
      decision: null,
      feedback: null,
      lesson: "",
    };
    p.issues.push(created);
    newIds.push(created.id);
  }
  p.issues.sort((a, b) => a.day - b.day);

  issue.fix = {
    summary: result.summary,
    diffs,
    arch_before: archBefore,
    arch_after: archAfter,
    arch_notes: result.arch_notes,
    effects,
    new_issue_ids: newIds,
    before_files: beforeFiles,
    verification,
  };
  // 修正の結果を会話に流し、振り返りに進む
  issue.chat.push({ role: "event", kind: "fix", text: result.summary });
  issue.chat.push({
    role: "event",
    kind: "fix",
    text: `自動チェック: ${checkParts.join("")}`,
  });
  if (result.reflection) {
    issue.chat.push({ role: "senior", name: "先輩", text: result.reflection });
  }
  issue.phase = "reflect";
  if (!issue.feedback) {
    issue.feedback = {
      consequence: result.summary,
      covered: [],
      questions: [],
      stance_gap: "",
    };
  }
}
