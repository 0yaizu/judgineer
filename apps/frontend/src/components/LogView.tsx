import { useEffect, useRef } from "react";

export type LogLine = {
  key: string;
  time: string;
  source: string;
  level: "info" | "warn" | "error" | "ok";
  text: string;
};

// 色はモックに合わせて、暗い背景のターミナル風にする
const LEVEL_CLASS: Record<LogLine["level"], string> = {
  info: "text-[#c9d1d9]",
  ok: "text-[#7ee2b8]",
  warn: "text-[#f2cc60]",
  error: "font-medium text-[#ff9b85]",
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
    <div className="overflow-hidden rounded-lg bg-[#161b22] text-[#c9d1d9]">
      {title && <div className="px-3 pt-2 text-xs text-[#8b949e]">{title}</div>}
      <div
        ref={ref}
        role="log"
        aria-label={title ?? "ログ"}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: キーボードだけでもスクロールできるようにする
        tabIndex={0}
        className="overflow-y-auto px-3 pt-1.5 pb-2.5 font-mono text-[12.5px] leading-[1.7]"
        style={{ height }}
      >
        {lines.length === 0 && (
          <p className="text-[#6e7681]">まだログはありません</p>
        )}
        {lines.map((l) => (
          <div
            key={l.key}
            className="grid gap-x-2.5 whitespace-pre-wrap break-all sm:grid-cols-[124px_76px_1fr]"
          >
            <span className="text-[#6e7681]">{l.time}</span>
            <span className="truncate text-[#8b949e]">{l.source}</span>
            <span className={LEVEL_CLASS[l.level]}>
              {LEVEL_TAG[l.level]}
              {l.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
