import { issueDetailSchema } from "@tka/shared";
import { generate } from "./ai/client";
import { cleanSignals, settled } from "./clean";
import { parsePartialJson } from "./partial-json";
import { partialDetail } from "./partial-view";
import { endProgress, setChars, setPartial, setStage } from "./progress";
import { loadProject, srcDir } from "./project";
import { analyzeSystem, detailPrompt } from "./prompts/analyze";
import * as repo from "./repo";
import { readConfig, readSources, scannerFindings } from "./scanner";
import type { Issue } from "./types";

/** 本文が作ってあるか (空文字が未生成の印。昔のデータは最初から入っている) */
export const hasDetail = (i: Pick<Issue, "incident_story">) =>
  i.incident_story !== "";

// shortcut: メモリ上だけ (プロセスが1つの前提)
const inflight = new Map<string, Promise<void>>();

/** 本文が未生成なら AI に作らせて保存する。同じ出来事の同時呼び出しは1回にまとめる */
export function ensureDetail(pid: string, iid: string): Promise<void> {
  const key = `${pid}:${iid}`;
  const running = inflight.get(key);
  // 終わったあとにもう一度確かめる (捨てられた古い結果に相乗りしたままにしない)
  if (running) return running.then(() => ensureDetail(pid, iid));
  const job = generateDetail(pid, iid, key).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function generateDetail(
  pid: string,
  iid: string,
  key: string,
): Promise<void> {
  const p = loadProject(pid);
  const issue = p.issues.find((i) => i.id === iid);
  if (!issue || hasDetail(issue)) return;
  const parent = issue.escalated_from
    ? p.issues.find((i) => i.id === issue.escalated_from)
    : undefined;
  const src = srcDir(pid);
  setStage(key, 1, 1, "出来事の詳細を書いています");
  const result = await generate({
    task: "detail",
    onProgress: (n) => setChars(key, n),
    onPartial: (json) =>
      setPartial(key, () => partialDetail(parsePartialJson(json))),
    // analyze.ts と完全に同じ引数にして、キャッシュを効かせる
    system: analyzeSystem({
      bg: p.background,
      sources: readSources(src, 60_000, scannerFindings(p.findings)),
      config: readConfig(src),
    }),
    prompt: detailPrompt({
      issue,
      findings: p.findings.filter((f) => issue.finding_ids.includes(f.id)),
      arch: p.architecture,
      others: p.issues
        .filter((i) => i.id !== iid)
        .sort((a, b) => a.day - b.day)
        .map(({ day, title, incident_title }) => ({
          day,
          title,
          incident_title,
        })),
      parent: parent && {
        incident_story: parent.incident_story,
        reason:
          parent.if_ignored?.reason ?? parent.skipped?.impact_reason ?? "",
      },
    }),
    schema: issueDetailSchema,
  }).finally(() => endProgress(key));
  // 待っている間に他の保存が入っているかもしれないので、読み直してから書く
  const fresh = loadProject(pid);
  const target = fresh.issues.find((i) => i.id === iid);
  if (!target || hasDetail(target)) return;
  // 待っている間に再分析されて、同じ id が別の出来事になっていたら捨てる
  if (
    target.title !== issue.title ||
    target.incident_title !== issue.incident_title ||
    target.finding_ids.join() !== issue.finding_ids.join()
  )
    return;
  target.incident_story = result.incident_story;
  target.signals = cleanSignals(result.signals);
  // 見送りから生まれた出来事は、skip 時にコピーした値を残す
  if (!target.escalated_from) {
    target.what_happens = result.what_happens;
    target.who_is_affected = result.who_is_affected;
    target.background_link = result.background_link;
  }
  repo.saveProject(fresh);
}

/** 一番早い day の未生成の出来事を先に作る。失敗は握りつぶす (開いたときに作り直す) */
export function prefetch(pid: string, afterDay = 0): Promise<void> {
  try {
    const next = loadProject(pid).issues.find(
      (i) => i.day > afterDay && !hasDetail(i) && !settled(i),
    );
    if (!next) return Promise.resolve();
    return ensureDetail(pid, next.id).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/** 画面から開かれたとき用: 本文を作ってから、次の1件を先読みする */
export async function openDetail(pid: string, iid: string): Promise<void> {
  await ensureDetail(pid, iid);
  const day = loadProject(pid).issues.find((i) => i.id === iid)?.day ?? 0;
  void prefetch(pid, day);
}
