import { IconPlus } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
import { ButtonVariants } from "#/components/starwind/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/components/starwind/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/starwind/table";
import { Waiting } from "#/components/Waiting";
import { api } from "#/lib/api";
import type { AppSummary, ProjectSummary } from "#/lib/types";

const RECENT = 5;

export const Route = createFileRoute("/")({ component: Projects });

function Projects() {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [sessions, setSessions] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .apps()
      .then(setApps)
      .catch((e: Error) => setError(e.message));
    api
      .projects()
      .then(setSessions)
      .catch(() => {});
  }, []);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="grid content-start gap-6">
        <div className="grid gap-4">
          <div>
            <h1 className="text-2xl font-bold">登録したアプリ</h1>
            <p className="mt-2 text-muted-foreground">
              ジャッジニアに登録したアプリの一覧です。選ぶと、登録した内容を入れた登録画面が開きます。
            </p>
          </div>
          <Link
            to="/register"
            className={`${ButtonVariants.button({ variant: "primary" })} justify-self-end`}
          >
            <IconPlus />
            アプリを登録
          </Link>
        </div>
        <ErrorBox message={error} />
        {!apps && !error && <Waiting text="読み込み中" />}
        {apps?.length === 0 && (
          <p className="text-muted-foreground">
            まだ登録がありません。「アプリを登録」から始めてください。
          </p>
        )}
        {apps && apps.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>アプリ名</TableHead>
                <TableHead>最終登録日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      to="/register"
                      search={{ app: p.id }}
                      className="font-medium hover:underline"
                    >
                      {p.title}
                    </Link>
                  </TableCell>
                  <TableCell>{p.updated_at.slice(0, 10)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <aside>
        <Card size="sm">
          <CardHeader>
            <CardTitle>セッション履歴</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">まだありません</p>
            )}
            <ul className="divide-y">
              {sessions.slice(0, RECENT).map((s) => (
                <li key={s.id} className="py-2">
                  <Link
                    to="/p/$pid"
                    params={{ pid: s.id }}
                    className="font-medium hover:underline"
                  >
                    {s.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {s.created_at.slice(0, 10)}・判断済み {s.decided}/{s.issues}
                  </p>
                </li>
              ))}
            </ul>
            {sessions.length > RECENT && (
              <Link to="/sessions" className="mt-2 block text-sm underline">
                すべて見る
              </Link>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
