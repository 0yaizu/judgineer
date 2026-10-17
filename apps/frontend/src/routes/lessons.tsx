import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/starwind/card";
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
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">判断の記録</h1>
        <p className="mt-2 text-muted-foreground">
          これまでに判断した問題と、そのとき残したメモです。次のアプリを作るときの見返し用です。
        </p>
      </div>
      <ErrorBox message={error} />
      {!lessons && !error && <Waiting text="読み込み中" />}
      {lessons?.length === 0 && (
        <p className="text-muted-foreground">
          まだ記録がありません。出来事に対応して振り返りでメモを残すか、見送ると、ここに並びます。
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {lessons?.map((l) => (
          <Card key={l.id}>
            <CardHeader>
              <CardDescription className="text-sm">
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
              </CardDescription>
              <CardTitle>{l.issue_title}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {l.stance && <Row term="最初の方針" text={l.stance} />}
                <Row term="判断" text={l.chosen} />
                <Row term="理由" text={l.reason} />
                {l.lesson && (
                  <Row term="次へのメモ" text={l.lesson} highlight />
                )}
              </dl>
            </CardContent>
          </Card>
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
    <div
      className={`grid grid-cols-[6rem_1fr] gap-3 ${highlight ? "rounded-md bg-primary/10 p-2" : ""}`}
    >
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{text}</dd>
    </div>
  );
}
