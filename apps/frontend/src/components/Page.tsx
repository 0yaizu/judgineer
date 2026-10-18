import type { ReactNode } from "react";

/** 主ボタン（丸い濃い色のボタン）。Link や button の className に使う */
export const pillClass =
  "inline-flex items-center justify-center gap-2.5 rounded-full bg-ink px-7 py-3 text-sm font-medium tracking-[0.12em] text-background shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary hover:text-white hover:shadow-xl hover:shadow-primary/25 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:transition-transform hover:[&_svg]:translate-x-0.5";

/** 白いパネル。ページの中のまとまりに使う */
export const panelClass =
  "rounded-2xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.08)]";

/** 各ページの見出し。eyebrow は見出しの上の小さな英字 */
export function PageHeader({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-10 flex animate-in flex-wrap items-end justify-between gap-6 duration-700 fade-in slide-in-from-bottom-1">
      <div className="max-w-[46em]">
        <p className="text-[11px] font-semibold tracking-[0.4em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-display text-[34px] leading-tight font-extrabold tracking-[0.04em]">
          {title}
        </h1>
        {children && (
          <p className="mt-3 leading-relaxed text-sub">{children}</p>
        )}
      </div>
      {action}
    </header>
  );
}

/** 何もないときの表示。次にすることへ案内する */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={`${panelClass} flex flex-col items-center gap-3 px-6 py-16 text-center`}
    >
      <p className="font-display text-lg font-extrabold">{title}</p>
      {children && <p className="max-w-[32em] text-sm text-sub">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export type Order = "new" | "old";

/** 作成日の並び替え。a, b は "2026-10-17T..." のような日時の文字列 */
export const byDate = (order: Order) => (a: string, b: string) =>
  order === "new" ? b.localeCompare(a) : a.localeCompare(b);

/** 新しい順・古い順の切り替え */
export function OrderToggle({
  value,
  onChange,
}: {
  value: Order;
  onChange: (v: Order) => void;
}) {
  return (
    <fieldset className="inline-flex gap-1 rounded-full border bg-muted p-1 text-sm">
      <legend className="sr-only">並び順</legend>
      {(
        [
          ["new", "新しい順"],
          ["old", "古い順"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3.5 py-1.5 transition-all duration-300 ${
            value === v
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-sub hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
