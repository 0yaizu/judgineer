import { useEffect, useState } from "react";
import { ArchDiagram } from "#/components/ArchDiagram";
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
}: {
  text: string;
  pid?: string;
  iid?: string;
}) {
  const [sec, setSec] = useState(0);
  const [info, setInfo] = useState<Progress | null>(null);

  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!pid) return;
    let live = true;
    const t = setInterval(() => {
      (iid ? api.issueProgress(pid, iid) : api.progress(pid))
        .then((r) => live && setInfo(r))
        .catch(() => {});
    }, 500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pid, iid]);

  const stage = info?.stage ? `(${info.step}/${info.total}) ${info.stage}` : "";
  const view = readPartial(info?.partial);
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
        {!!info?.chars && <span>{info.chars.toLocaleString()}文字</span>}
        <span>経過{sec}秒</span>
      </output>
      {view.architecture && view.architecture.nodes.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-lg border p-2">
          <ArchDiagram arch={view.architecture} compact />
        </div>
      )}
      {view.issues.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border px-3 py-2 text-sm">
          {view.issues.map((i) => (
            <li key={`${i.day}-${i.title}`}>
              {i.day}日目 [{i.severity}] {i.title}
            </li>
          ))}
        </ul>
      )}
      {view.incident_story && (
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          {view.incident_story}
        </p>
      )}
      {logs.length > 0 && <LogView lines={logs} height={140} />}
    </div>
  );
}
