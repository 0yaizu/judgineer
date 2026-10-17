import { IconAlertTriangle } from "@tabler/icons-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Badge } from "#/components/starwind/badge";
import { api } from "#/lib/api";
import type { Finding } from "#/lib/types";

const SCROLL_MARGIN = 90;

/**
 * 根拠になったコード。ファイルはバックエンドから読む（登録時のコピー）。
 * hideLabels: 検出ルールの名前を隠す。会話で自分で原因にたどり着くまで、答えを見せない
 */
export function CodeView({
  pid,
  findings,
  hideLabels = false,
}: {
  pid: string;
  findings: Finding[];
  hideLabels?: boolean;
}) {
  const files = [...new Set(findings.map((f) => f.file))];
  const [file, setFile] = useState(files[0]);
  const [content, setContent] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!file || content[file] !== undefined) return;
    api
      .file(pid, file, "original")
      .then((r) => setContent((c) => ({ ...c, [file]: r.content })))
      .catch((e: Error) => setError(e.message));
  }, [pid, file, content]);

  const text = file ? content[file] : undefined;

  // ファイルが読めたら、最初の該当行が見える位置までスクロールする
  useEffect(() => {
    if (text === undefined) return;
    const el = bodyRef.current?.querySelector<HTMLElement>("[data-hit]");
    if (el && bodyRef.current)
      bodyRef.current.scrollTop = Math.max(0, el.offsetTop - SCROLL_MARGIN);
  }, [text]);

  if (!file) return null;
  // 表示中のファイルの指摘を、行ごとにまとめる（同じ行に複数あり得る）
  const hits = new Map<number, Finding[]>();
  for (const f of findings.filter((x) => x.file === file))
    hits.set(f.line, [...(hits.get(f.line) ?? []), f]);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/50 px-2 py-1 font-mono text-xs">
        {files.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFile(f)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 ${f === file ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {f}
            <Badge variant="error" size="sm">
              {findings.filter((x) => x.file === f).length}
            </Badge>
          </button>
        ))}
      </div>
      {error && <p className="p-3 text-sm text-error">{error}</p>}
      <section
        ref={bodyRef}
        aria-label="コード"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: キーボードだけでもスクロールできるようにする
        tabIndex={0}
        className="relative max-h-96 overflow-auto py-2 font-mono text-xs leading-6"
      >
        {text === undefined && !error && (
          <p className="px-4 text-muted-foreground">読み込み中…</p>
        )}
        {text?.split("\n").map((line, n) => {
          const no = n + 1;
          const hit = hits.get(no);
          return (
            <Fragment key={no}>
              <div
                data-hit={hit ? "" : undefined}
                className={`grid grid-cols-[3rem_1fr] ${hit ? "bg-error/10" : ""}`}
              >
                <span className="select-none pr-3 text-right text-muted-foreground">
                  {no}
                </span>
                <span className="whitespace-pre">{line || " "}</span>
              </div>
              {hit && hideLabels && (
                <div className="flex flex-wrap items-center gap-x-3 border-l-2 border-error bg-error/5 py-1 pr-3 pl-14 text-error">
                  <IconAlertTriangle className="size-3.5" />
                  <span className="font-sans text-sm">
                    機械的なチェックが、この行を気にしています
                  </span>
                </div>
              )}
              {!hideLabels &&
                hit?.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-wrap items-center gap-x-3 border-l-2 border-error bg-error/5 py-1 pr-3 pl-14 text-error"
                  >
                    <IconAlertTriangle className="size-3.5" />
                    <span className="font-sans text-sm">{f.title}</span>
                    <span className="text-muted-foreground">
                      検出ルール: {f.rule}
                    </span>
                  </div>
                ))}
            </Fragment>
          );
        })}
      </section>
    </div>
  );
}
