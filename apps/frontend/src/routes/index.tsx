import { IconArrowRight } from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { Background } from "@tka/shared";
import { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/components/starwind/alert";
import { Button } from "#/components/starwind/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/components/starwind/card";
import { Input } from "#/components/starwind/input";
import { Label } from "#/components/starwind/label";
import { Textarea } from "#/components/starwind/textarea";
import { SAMPLE_BACKGROUND } from "#/lib/sample-data";
import { createProject, useStore } from "#/lib/store";

export const Route = createFileRoute("/")({ component: Home });

const FIELDS: {
  key: keyof Background;
  label: string;
  hint: string;
  rows: number;
}[] = [
  {
    key: "title",
    label: "アプリ名",
    hint: "例: A社 顧客データ提供API",
    rows: 1,
  },
  {
    key: "stakeholders",
    label: "関係者",
    hint: "誰が作って、誰が使っているか。取引先や社内の部署など",
    rows: 2,
  },
  {
    key: "data_flow",
    label: "データの流れ",
    hint: "どこからどこへ、いつデータが渡るか",
    rows: 2,
  },
  {
    key: "data_types",
    label: "扱うデータ",
    hint: "個人情報、決済情報など",
    rows: 1,
  },
  {
    key: "constraints",
    label: "契約・制約",
    hint: "納期、SLA、止めたときの影響、法律など",
    rows: 2,
  },
  {
    key: "team",
    label: "チームの体制",
    hint: "人数、担当、今後の予定",
    rows: 1,
  },
  {
    key: "notes",
    label: "その他",
    hint: "今後の予定や気になっていること",
    rows: 2,
  },
];

function Home() {
  const navigate = useNavigate();
  const { projects } = useStore();
  const [bg, setBg] = useState<Background>(SAMPLE_BACKGROUND);

  const submit = () => {
    const p = createProject(bg);
    navigate({ to: "/p/$pid", params: { pid: p.id } });
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="grid content-start gap-6">
        <div>
          <h1 className="text-2xl font-bold">完成したアプリを登録する</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            完成したアプリと、その背景を入力してください。公開後の運用を早送りで再生し、途中で起きる出来事に自分で対応していきます。
          </p>
        </div>

        <Alert variant="info">
          <AlertTitle>1. アプリのコード</AlertTitle>
          <AlertDescription>
            このデモでは、サンプルアプリ「A社
            顧客データ提供API」のコードを使います（フォルダ・zip
            の読み込みには対応していません）。
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>2. アプリの背景</CardTitle>
            <p className="text-sm text-muted-foreground">
              AIはコードしか見られません。どちらの修正が良いかは、ここに書いた事情で変わります。
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            {FIELDS.map((f) => (
              <div
                key={f.key}
                className="grid gap-1.5 sm:grid-cols-[8rem_1fr] sm:gap-4"
              >
                <Label htmlFor={f.key} className="sm:pt-2.5">
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
            <div className="flex items-center gap-3 sm:pl-36">
              <Button
                variant="primary"
                disabled={!bg.title.trim()}
                onClick={submit}
              >
                運用シミュレーションを作る
                <IconArrowRight />
              </Button>
              <Button variant="ghost" onClick={() => setBg(SAMPLE_BACKGROUND)}>
                サンプルの内容に戻す
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <aside>
        <Card size="sm">
          <CardHeader>
            <CardTitle>これまでのアプリ</CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground">まだありません</p>
            )}
            <ul className="divide-y">
              {projects.map((p) => (
                <li key={p.id} className="py-2">
                  <Link
                    to="/p/$pid"
                    params={{ pid: p.id }}
                    className="font-medium hover:underline"
                  >
                    {p.background.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {p.created_at.slice(0, 10)}・判断済み{" "}
                    {p.issues.filter((i) => i.feedback).length}/
                    {p.issues.length}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
