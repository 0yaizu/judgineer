import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/starwind/card";
import { useStore } from "#/lib/store";

export const Route = createFileRoute("/lessons")({ component: Lessons });

function Lessons() {
  const { lessons } = useStore();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">判断の記録</h1>
        <p className="mt-2 text-muted-foreground">
          これまでに判断した問題と、そのとき残したメモです。次のアプリを作るときの見返し用です。
        </p>
      </div>
      {lessons.length === 0 && (
        <p className="text-muted-foreground">
          まだ記録がありません。問題を判断して「メモを残す」と、ここに並びます。
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {lessons.map((l) => (
          <Card key={l.id}>
            <CardHeader>
              <CardDescription className="text-sm">
                {l.created_at.slice(0, 10)}・
                <Link
                  to="/p/$pid/i/$iid"
                  params={{
                    pid: l.project_id,
                    iid: l.issue_id,
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
