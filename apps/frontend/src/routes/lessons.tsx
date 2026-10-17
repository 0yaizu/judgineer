import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
import { Waiting } from "#/components/Waiting";
import { api } from "#/lib/api";
import type { Lesson } from "#/lib/types";

export const Route = createFileRoute("/lessons")({ component: Lessons });

function Lessons() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .lessons()
      .then(setLessons)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="mt-1.5 mb-3 text-[26px] leading-snug font-bold">
        判断の記録
      </h1>
      <p className="mb-7 max-w-[46em] text-sub">
        これまでに判断した問題と、そのとき残したメモです。次のアプリを作るときの見返し用です。
      </p>
      <ErrorBox message={error} />
      {!lessons && !error && <Waiting text="読み込み中" />}
      {lessons?.length === 0 && (
        <p className="text-muted-foreground">
          まだ記録がありません。出来事に対応して振り返りでメモを残すか、見送ると、ここに並びます。
        </p>
      )}
      <div className="flex flex-col gap-4">
        {lessons?.map((l) => (
          <article key={l.id} className="rounded-md border px-5 py-4">
            <p className="text-[13px] text-muted-foreground">
              {l.created_at.slice(0, 10)}・
              <Link
                to="/p/$pid/i/$iid"
                params={{
                  pid: l.project_id,
                  iid: l.id.split("-").pop() ?? "",
                }}
                className="underline"
              >
                {l.project_title}
              </Link>
            </p>
            <h2 className="mt-0.5 mb-1 text-[17px] font-bold">
              {l.issue_title}
            </h2>
            <dl className="mt-2.5">
              {l.stance && <Row term="最初の方針" text={l.stance} />}
              <Row term="判断" text={l.chosen} />
              <Row term="理由" text={l.reason} />
              {l.lesson && <Row term="次へのメモ" text={l.lesson} highlight />}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}

function Row({
  term,
  text,
  highlight,
}: {
  term: string;
  text: string;
  highlight?: boolean;
}) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-t border-line-soft py-1.5 sm:grid-cols-[120px_1fr]">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className={highlight ? "font-medium" : ""}>{text}</dd>
    </div>
  );
}
