import { IconAlertTriangle } from "@tabler/icons-react";
import type { Finding } from "@tka/shared";
import { Fragment, useEffect, useRef } from "react";
import { Badge } from "#/components/starwind/badge";

const SCROLL_MARGIN = 90;

export function CodeView({
  code,
  findings,
}: {
  code: string;
  findings: Finding[];
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const file = findings[0]?.file;
  // 表示中のコードと同じファイルの指摘だけを、行ごとにまとめる（同じ行に複数あり得る）
  const inFile = findings.filter((f) => f.file === file);
  const hits = new Map<number, Finding[]>();
  for (const f of inFile) hits.set(f.line, [...(hits.get(f.line) ?? []), f]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 出来事が変わったら、最初の該当行が見える位置までスクロールする
  useEffect(() => {
    const el = bodyRef.current?.querySelector<HTMLElement>("[data-hit]");
    if (el && bodyRef.current)
      bodyRef.current.scrollTop = Math.max(0, el.offsetTop - SCROLL_MARGIN);
  }, [findings]);

  if (!file) return null;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 font-mono text-xs">
        {file}
        <Badge variant="error" size="sm">
          {inFile.length}
        </Badge>
      </div>
      <section
        ref={bodyRef}
        aria-label="コード"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: キーボードだけでもスクロールできるようにする
        tabIndex={0}
        className="relative max-h-80 overflow-auto py-2 font-mono text-xs leading-6"
      >
        {code.split("\n").map((text, n) => {
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
                <span className="whitespace-pre">{text || " "}</span>
              </div>
              {hit?.map((f) => (
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
