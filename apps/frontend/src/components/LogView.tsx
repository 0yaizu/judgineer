import { useEffect, useRef } from "react";

export type LogLine = {
  key: string;
  time: string;
  source: string;
  level: "info" | "warn" | "error" | "ok";
  text: string;
};

const LEVEL_CLASS: Record<LogLine["level"], string> = {
  info: "text-muted-foreground",
  ok: "text-green-700 dark:text-green-400",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-error",
};

const LEVEL_TAG: Partial<Record<LogLine["level"], string>> = {
  error: "ERROR ",
  warn: "WARN  ",
};

export function LogView({
  lines,
  title,
  height = 220,
}: {
  lines: LogLine[];
  title?: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 行が増えたら末尾までスクロールする
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/40">
      {title && (
        <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      )}
      <div
        ref={ref}
        role="log"
        aria-label={title ?? "ログ"}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: キーボードだけでもスクロールできるようにする
        tabIndex={0}
        className="overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
        style={{ height }}
      >
        {lines.length === 0 && (
          <p className="text-muted-foreground">まだログはありません</p>
        )}
        {lines.map((l) => (
          <div
            key={l.key}
            className={`grid grid-cols-[max-content_5rem_1fr] gap-x-3 ${LEVEL_CLASS[l.level]}`}
          >
            <span className="opacity-70">{l.time}</span>
            <span className="opacity-70">{l.source}</span>
            <span className="break-words">
              {LEVEL_TAG[l.level]}
              {l.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
