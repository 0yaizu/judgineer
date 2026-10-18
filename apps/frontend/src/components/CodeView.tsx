import { IconAlertTriangle } from "@tabler/icons-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { PathBar } from "#/components/PathBar";
import { api } from "#/lib/api";
import type { Finding } from "#/lib/types";

const SCROLL_MARGIN = 90;

// hideLabels: 自分で原因にたどり着くまで、検出ルールの名前を見せない
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

  useEffect(() => {
    if (text === undefined) return;
    const el = bodyRef.current?.querySelector<HTMLElement>("[data-hit]");
    if (el && bodyRef.current)
      bodyRef.current.scrollTop = Math.max(0, el.offsetTop - SCROLL_MARGIN);
  }, [text]);

  if (!file) return null;
  const hits = new Map<number, Finding[]>();
  for (const f of findings.filter((x) => x.file === file))
    hits.set(f.line, [...(hits.get(f.line) ?? []), f]);

  return (
    <div className="overflow-hidden rounded-lg bg-[#161b22] dark:bg-[#0b0f12] dark:ring-1 dark:ring-border">
      <div className="flex flex-wrap bg-[#0d1117]">
        {files.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFile(f)}
            title={f}
            className={`px-3.5 py-2 font-mono text-[12.5px] ${f === file ? "border-t-2 border-[#f2cc60] bg-[#161b22] text-[#e6edf3]" : "border-t-2 border-transparent text-[#8b949e] hover:text-[#e6edf3]"}`}
          >
            {f.split("/").pop()}
            <span className="ml-2 rounded-lg bg-[#ff9b85] px-1.5 text-[11px] text-[#161b22]">
              {findings.filter((x) => x.file === f).length}
            </span>
          </button>
        ))}
      </div>
      <PathBar file={file} />
      {error && <p className="p-3 text-sm text-error">{error}</p>}
      <section
        ref={bodyRef}
        aria-label="コード"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: キーボードだけでもスクロールできるようにする
        tabIndex={0}
        className="relative max-h-[420px] overflow-auto py-2 font-mono text-[12.5px] leading-[1.65] text-[#c9d1d9]"
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
                className={`grid grid-cols-[52px_1fr] ${hit ? "bg-[#ff9b85]/15 shadow-[inset_3px_0_0_#ff9b85]" : ""}`}
              >
                <span
                  className={`select-none pr-3.5 text-right ${hit ? "text-[#ff9b85]" : "text-[#6e7681]"}`}
                >
                  {no}
                </span>
                <span className="whitespace-pre pr-4">{line || " "}</span>
              </div>
              {hit && hideLabels && (
                <div className="mt-0.5 mr-4 mb-1.5 ml-[52px] flex flex-wrap items-center gap-x-2.5 rounded bg-[#2d1f1b] px-2.5 py-1 font-sans text-[12.5px] text-[#ffb8a6]">
                  <IconAlertTriangle className="size-3.5" />
                  <span>機械的なチェックが、この行を気にしています</span>
                </div>
              )}
              {!hideLabels &&
                hit?.map((f) => (
                  <div
                    key={f.id}
                    className="mt-0.5 mr-4 mb-1.5 ml-[52px] flex flex-wrap items-center gap-x-2.5 rounded bg-[#2d1f1b] px-2.5 py-1 font-sans text-[12.5px] text-[#ffb8a6]"
                  >
                    <IconAlertTriangle className="size-3.5" />
                    <span>{f.title}</span>
                    <span className="text-[11.5px] text-[#8b949e]">
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
