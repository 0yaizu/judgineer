import { IconArrowRight, IconPlus } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SIM_DAYS } from "@tka/shared";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
import {
  byDate,
  EmptyState,
  type Order,
  OrderToggle,
  PageHeader,
  panelClass,
  pillClass,
} from "#/components/Page";
import { Waiting } from "#/components/Waiting";
import { api } from "#/lib/api";
import type { ProjectSummary } from "#/lib/types";

export const Route = createFileRoute("/sessions")({ component: Sessions });

type Filter = "all" | "active" | "done";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "active", label: "進行中" },
  { key: "done", label: "完了" },
];

// 運用を最後の日まで進めたら完了。出来事の総数は先のネタバレになるので使わない
const isDone = (s: ProjectSummary) => s.sim_day >= SIM_DAYS;

function Sessions() {
  const [sessions, setSessions] = useState<ProjectSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<Order>("new");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .projects()
      .then(setSessions)
      .catch((e: Error) => setError(e.message));
  }, []);

  const shown = (sessions ?? [])
    .filter((s) =>
      filter === "all" ? true : filter === "done" ? isDone(s) : !isDone(s),
    )
    .sort((a, b) => byDate(order)(a.created_at, b.created_at));
  const count = (f: Filter) =>
    (sessions ?? []).filter((s) =>
      f === "all" ? true : f === "done" ? isDone(s) : !isDone(s),
    ).length;

  return (
    <div>
      <PageHeader
        eyebrow="SESSIONS"
        title="セッション履歴"
        action={
          <Link to="/register" className={pillClass}>
            <IconPlus />
            新しく始める
          </Link>
        }
      >
        これまでに作った運用シミュレーションです。選ぶと、止めたところから再開できます。
      </PageHeader>

      <ErrorBox message={error} />
      {!sessions && !error && <Waiting text="読み込み中" />}

      {sessions?.length === 0 && (
        <EmptyState
          title="まだセッションがありません"
          action={
            <Link to="/register" className={pillClass}>
              アプリを登録する
              <IconArrowRight />
            </Link>
          }
        >
          アプリを登録すると、公開後の運用を早送りで再生するセッションが始まります。
        </EmptyState>
      )}

      {sessions && sessions.length > 0 && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="絞り込み"
              className="inline-flex gap-1 rounded-full border bg-muted p-1"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-4 py-1.5 text-sm transition-all duration-300 ${
                    filter === f.key
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-sub hover:text-foreground"
                  }`}
                >
                  {f.label}
                  <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                    {count(f.key)}
                  </span>
                </button>
              ))}
            </div>
            <OrderToggle value={order} onChange={setOrder} />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              この条件のセッションはありません
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {shown.map((s, n) => (
                <li
                  key={s.id}
                  className="animate-in fill-mode-backwards duration-500 fade-in slide-in-from-bottom-1"
                  style={{ animationDelay: `${Math.min(n, 8) * 50}ms` }}
                >
                  <SessionCard s={s} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SessionCard({ s }: { s: ProjectSummary }) {
  const done = isDone(s);
  const day = Math.min(s.sim_day, SIM_DAYS);
  const pct = Math.round((day / SIM_DAYS) * 100);
  return (
    <Link
      to="/p/$pid"
      params={{ pid: s.id }}
      className={`${panelClass} group flex h-full flex-col gap-5 p-6 text-foreground transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:text-foreground hover:shadow-[0_12px_32px_-12px_rgb(31_157_116/0.35)]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-extrabold">
            {s.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {s.created_at.slice(0, 10).replaceAll("-", ".")}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            done ? "bg-tint text-primary-accent" : "bg-warn-tint text-error"
          }`}
        >
          {done ? "完了" : "進行中"}
        </span>
      </div>

      <div className="mt-auto">
        <div className="mb-2 flex items-baseline justify-between text-xs text-sub">
          <span>
            運用 <b className="text-base text-foreground tabular-nums">{day}</b>
            日目 / {SIM_DAYS}日
          </span>
          <span className="tabular-nums">判断した出来事 {s.decided}件</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
        {done ? "振り返る" : "続きから再開"}
        <IconArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
