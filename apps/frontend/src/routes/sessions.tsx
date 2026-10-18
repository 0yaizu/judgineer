import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
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
import type { ProjectSummary } from "#/lib/types";

export const Route = createFileRoute("/sessions")({ component: Sessions });

function Sessions() {
  const [sessions, setSessions] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .projects()
      .then(setSessions)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">セッション履歴</h1>
        <p className="mt-2 text-muted-foreground">
          これまでに作った運用シミュレーションの一覧です。選ぶと、続きから再開できます。
        </p>
      </div>
      <ErrorBox message={error} />
      {!sessions && !error && <Waiting text="読み込み中" />}
      {sessions?.length === 0 && (
        <p className="text-muted-foreground">まだ履歴がありません。</p>
      )}
      {sessions && sessions.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>アプリ名</TableHead>
              <TableHead>作成日</TableHead>
              <TableHead className="text-right">判断済み</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link
                    to="/p/$pid"
                    params={{ pid: s.id }}
                    className="font-medium hover:underline"
                  >
                    {s.title}
                  </Link>
                </TableCell>
                <TableCell>{s.created_at.slice(0, 10)}</TableCell>
                <TableCell className="text-right">
                  {s.decided}/{s.issues}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
