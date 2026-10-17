import { IconPlus } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
import { Alert, AlertDescription } from "#/components/starwind/alert";
import { Button } from "#/components/starwind/button";
import { Input } from "#/components/starwind/input";
import { Label } from "#/components/starwind/label";
import { Textarea } from "#/components/starwind/textarea";
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
    <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section>
        <h1 className="mt-1.5 mb-3 text-[26px] leading-snug font-bold">
          完成したアプリを登録する
        </h1>
        <p className="mb-7 max-w-[46em] text-sub">
          完成したアプリと、その背景を入力してください。公開後の運用を早送りで再生し、途中で起きる出来事に自分で対応していきます。
        </p>

        <h2 className="mt-7 mb-2.5 text-base font-bold">1. アプリのコード</h2>
        <Alert variant={target && !target.exists ? "error" : "info"}>
          <AlertDescription>
            {target ? (
              target.exists ? (
                <>
                  検査するフォルダ:{" "}
                  <code className="break-all">{target.dir}</code>
                  <br />
                  登録するとコードのコピーを取り、元のファイルは変えません。別のアプリにするときは、環境変数
                  TARGET_DIR を変えて起動し直してください。
                </>
              ) : (
                <>
                  検査するフォルダが見つかりません:{" "}
                  <code className="break-all">{target.dir}</code>
                </>
              )
            ) : (
              "読み込み中…"
            )}
          </AlertDescription>
        </Alert>

        <h2 className="mt-7 mb-2.5 text-base font-bold">2. アプリの背景</h2>
        <p className="text-[13px] text-muted-foreground">
          AIはコードしか見られません。どちらの修正が良いかは、ここに書いた事情で変わります。
        </p>
        <div className="mt-2 mb-5 grid gap-3.5">
          {FIELDS.map((f) => (
            <div
              key={f.key}
              className="grid gap-0.5 sm:grid-cols-[120px_1fr] sm:gap-4"
            >
              <Label htmlFor={f.key} className="text-sm font-medium sm:pt-2">
                {f.label}
              </Label>
              {f.rows === 1 ? (
                <Input
                  id={f.key}
                  value={bg[f.key]}
                  placeholder={f.hint}
                  onValueChange={(v) => setBg({ ...bg, [f.key]: v })}
                />
              ) : (
                <Textarea
                  id={f.key}
                  rows={f.rows}
                  value={bg[f.key]}
                  placeholder={f.hint}
                  onChange={(e) => setBg({ ...bg, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-3">
          <ErrorBox message={error} />
          {busy ? (
            <Waiting
              text={
                busyPid
                  ? "運用中に起きる出来事の台本を作っています（1〜2分かかります）"
                  : "コードを調べています"
              }
              pid={busyPid ?? undefined}
            />
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                disabled={!bg.title.trim() || !target?.exists}
                onClick={submit}
              >
                運用シミュレーションを作る
                <IconArrowRight />
              </Button>
              <Button variant="ghost" onClick={() => setBg(draftFrom(target))}>
                下書きに戻す
              </Button>
            </div>
          )}
        </div>
      </section>

      <aside>
        <h2 className="mt-1.5 text-sm text-sub">これまでのアプリ</h2>
        {projects.length === 0 && (
          <p className="text-[13px] text-muted-foreground">まだありません</p>
        )}
        <ul>
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex flex-col border-b border-line-soft py-2.5"
            >
              <Link to="/p/$pid" params={{ pid: p.id }} className="underline">
                {p.title}
              </Link>
              <span className="text-[13px] text-muted-foreground">
                {p.created_at.slice(0, 10)}・判断済み {p.decided}/{p.issues}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
