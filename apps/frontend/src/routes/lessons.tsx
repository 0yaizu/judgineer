import { IconArrowRight, IconSearch } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import type { Lesson } from "#/lib/types";

export const Route = createFileRoute("/lessons")({ component: Lessons });

// 探すときに見る項目
const searchText = (l: Lesson) =>
  [
    l.project_title,
    l.issue_title,
    l.stance,
    l.chosen,
    l.reason,
    l.lesson,
    l.category,
  ]
    .join("\n")
    .toLowerCase();

function Lessons() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("new");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .lessons()
      .then(setLessons)
      .catch((e: Error) => setError(e.message));
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (lessons ?? [])
    .filter((l) => !q || searchText(l).includes(q))
    .sort((a, b) => byDate(order)(a.created_at, b.created_at));

  return (
    <div>
      <PageHeader eyebrow="LESSONS" title="判断の記録">
        これまでに判断した出来事と、そのとき残したメモです。次のアプリを作る前に見返してください。
      </PageHeader>

      <ErrorBox message={error} />
      {!lessons && !error && <Waiting text="読み込み中" />}

      {lessons?.length === 0 && (
        <EmptyState
          title="まだ記録がありません"
          action={
            <Link to="/sessions" className={pillClass}>
              セッションを開く
              <IconArrowRight />
            </Link>
          }
        >
          運用中の出来事に対応して振り返りでメモを残すか、見送ると、ここに並びます。
        </EmptyState>
      )}

      {lessons && lessons.length > 0 && (
        <>
          <div className="mb-8 flex flex-wrap items-center gap-4">
            <label className="relative w-full max-w-md">
              <span className="sr-only">記録を探す</span>
              <IconSearch className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="アプリ名・出来事・メモで探す"
                className="h-11 w-full rounded-full border border-input bg-background pr-4 pl-11 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-0"
              />
            </label>
            <span className="text-sm text-muted-foreground tabular-nums">
              {shown.length}件
            </span>
            <span className="ml-auto">
              <OrderToggle value={order} onChange={setOrder} />
            </span>
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              「{query}」に当てはまる記録はありません
            </p>
          ) : (
            <ol className="grid gap-5">
              {shown.map((l, n) => (
                <li
                  key={l.id}
                  className="animate-in fill-mode-backwards duration-500 fade-in slide-in-from-bottom-1"
                  style={{ animationDelay: `${Math.min(n, 8) * 50}ms` }}
                >
                  <LessonCard l={l} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function LessonCard({ l }: { l: Lesson }) {
  return (
    <article className={`${panelClass} overflow-hidden`}>
      <div className="grid gap-5 p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {l.created_at.slice(0, 10).replaceAll("-", ".")}
          </span>
          <Link
            to="/p/$pid/i/$iid"
            params={{
              pid: l.project_id,
              iid: l.id.split("-").pop() ?? "",
            }}
            className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-sub hover:bg-tint hover:text-primary-accent"
          >
            {l.project_title}
          </Link>
          {l.category && <span>{l.category}</span>}
        </div>

        <h2 className="-mt-2 font-display text-xl leading-snug font-extrabold">
          {l.issue_title}
        </h2>

        {l.lesson && (
          <blockquote className="relative rounded-xl bg-tint px-5 py-4 pl-6">
            <span
              aria-hidden
              className="absolute top-3 bottom-3 left-0 w-1 rounded-full bg-primary"
            />
            <p className="text-[11px] font-semibold tracking-[0.3em] text-primary">
              次へのメモ
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed font-medium">
              {l.lesson}
            </p>
          </blockquote>
        )}

        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <Item term="判断" text={l.chosen} />
          <Item term="理由" text={l.reason} />
          {l.stance && <Item term="最初の方針" text={l.stance} wide />}
        </dl>
      </div>
    </article>
  );
}

function Item({
  term,
  text,
  wide,
}: {
  term: string;
  text: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-1 leading-relaxed">{text}</dd>
    </div>
  );
}
