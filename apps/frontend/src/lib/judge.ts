import type { Issue } from "./types";

export const MIN_SKIP_REASON = 2;
export const MIN_PLAN = 5;

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

/** 決めた直し方の名前 */
export const chosenLabel = (i: Issue) => i.chosen?.label ?? "前の修正";

/** 最初に止まる日（まだ決めていない出来事の日。なければ最終日） */
export function limitDay(issues: Issue[], total: number): number {
  const open = [...issues]
    .sort((a, b) => a.day - b.day)
    .find((i) => !isSettled(i));
  return open ? open.day : total;
}
