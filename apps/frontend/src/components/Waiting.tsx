import { useEffect, useState } from "react";
import { ArchDiagram } from "#/components/ArchDiagram";
import { CancelButton } from "#/components/CancelButton";
import { type LogLine, LogView } from "#/components/LogView";
import { Spinner } from "#/components/starwind/spinner";
import { api } from "#/lib/api";
import { readPartial } from "#/lib/partial";
import type { Progress } from "#/lib/types";

/**
 * AI を待っている間の表示。
 * pid だけ: 台本づくり / pid + iid: 出来事の本文づくり。0.5秒ごとに進捗と、途中の中身を聞いて出す
 */
export function Waiting({
  text,
  pid,
  iid,
  cancelPid,
}: {
  text: string;
  pid?: string;
  iid?: string;
  /** 渡すと、このセッションの AI の生成を止めるキャンセルボタンを出す */
  cancelPid?: string;
}) {
  const [sec, setSec] = useState(0);
  const [info, setInfo] = useState<Progress | null>(null);
  const [progressError, setProgressError] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!pid) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        const result = await (iid
          ? api.issueProgress(pid, iid)
          : api.progress(pid));
        if (!live) return;
        failures = 0;
        setProgressError(false);
        setInfo(result);
      } catch {
        if (!live) return;
        failures += 1;
        if (failures >= 3) setProgressError(true);
      }
      if (live) timer = setTimeout(poll, 500);
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [pid, iid]);

  const stage = info?.stage ? `(${info.step}/${info.total}) ${info.stage}` : "";
  const view = readPartial(info?.partial);
  const stats = info?.stats;
  const statLabels = [
    stats?.files !== undefined ? `${stats.files}ファイル` : undefined,
    stats?.languages?.length ? stats.languages.join("・") : undefined,
    stats?.checksTotal !== undefined
      ? `追加確認 ${stats.checksCompleted ?? 0}/${stats.checksTotal}`
      : undefined,
    stats?.nodes !== undefined
      ? `構成 ${stats.nodes}要素・${stats.edges ?? 0}接続`
      : undefined,
    stats?.flows !== undefined ? `${stats.flows}シナリオ` : undefined,
  ].filter((label): label is string => Boolean(label));
  const logs: LogLine[] = view.signals.map((s, n) => ({
    key: `${n}`,
    time: s.time,
    source: s.source,
    level: s.level,
    text: s.text,
  }));
  return (
    <div className="grid gap-3">
      <output className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        <span className="text-foreground">{stage || text}</span>
        {!!iid && !!info?.chars && (
          <span>{info.chars.toLocaleString()}文字</span>
        )}
        <span>経過{sec}秒</span>
      </output>
      {cancelPid && (
        <div>
          <CancelButton pid={cancelPid} />
        </div>
      )}
      {progressError && (
        <p className="text-sm text-warning">
          進捗の取得が一時的に途切れています。自動で再接続します。
        </p>
      )}
      {!iid && info?.steps && (
        <ol className="grid gap-1 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          {info.steps.map((label, index) => {
            const position = index + 1;
            const done = position < (info.step ?? 1);
            const active = position === (info.step ?? 1);
            return (
              <li
                className={
                  active
                    ? "text-foreground"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                }
                key={label}
              >
                <span className="mr-2 inline-block w-4 text-center">
                  {done ? "✓" : active ? "●" : "○"}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      )}
      {!iid && statLabels.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {statLabels.map((label) => (
            <span className="rounded-full border px-2 py-1" key={label}>
              {label}
            </span>
          ))}
        </div>
      )}
      {view.architecture && view.architecture.nodes.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-lg border p-2">
          <ArchDiagram arch={view.architecture} compact />
        </div>
      )}
      {view.incident_story && (
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          {view.incident_story}
        </p>
      )}
      {!!iid && !view.incident_story && (
        <div
          aria-label="出来事の本文を読み込み中"
          className="grid animate-pulse gap-2"
          role="status"
        >
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-11/12 rounded bg-muted" />
          <div className="h-4 w-3/4 rounded bg-muted" />
        </div>
      )}
      {logs.length > 0 && <LogView lines={logs} height={140} />}
      {!!iid && logs.length === 0 && (
        <div
          aria-label="ログを読み込み中"
          className="grid animate-pulse gap-2 rounded-lg border p-3"
          role="status"
        >
          <div className="h-4 w-5/6 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-4/5 rounded bg-muted" />
        </div>
      )}
    </div>
  );
}
