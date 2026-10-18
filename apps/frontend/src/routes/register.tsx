import { IconArrowRight, IconX } from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
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
import { Waiting } from "#/components/Waiting";
import { api } from "#/lib/api";
import type { AppSummary, Background, Target } from "#/lib/types";

const RECENT = 5;

export const Route = createFileRoute("/register")({
  // ?app=<id> で、そのアプリのフォルダを選び、登録済みの背景を入れた状態で開く (judgineer load もこの URL を開く)
  validateSearch: (s: Record<string, unknown>): { app?: string } =>
    typeof s.app === "string" ? { app: s.app } : {},
  component: Register,
});

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

const EMPTY: Background = {
  title: "",
  stakeholders: "",
  data_flow: "",
  data_types: "",
  constraints: "",
  team: "",
  notes: "",
};

// 検査対象に background.json があれば、それを下書きにする
const draftFrom = (t: Target | undefined): Background => ({
  ...EMPTY,
  ...Object.fromEntries(
    Object.entries(t?.background ?? {}).filter(
      ([k, v]) => k in EMPTY && typeof v === "string",
    ),
  ),
});

function Register() {
  const navigate = useNavigate();
  const { app } = Route.useSearch();
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetId, setTargetId] = useState<string | undefined>(app);
  const [bg, setBg] = useState<Background>(EMPTY);
  const [draft, setDraft] = useState<Background>(EMPTY);
  const [busyPid, setBusyPid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .apps()
      .then(setApps)
      .catch(() => {});
    Promise.all([api.targets(), app ? api.app(app) : null])
      .then(([list, a]) => {
        setTargets(list);
        // URL で指定されたフォルダ、なければ最後に読み込んだもの (一覧は新しい順)
        const first = list.find((t) => t.id === app) ?? list[0];
        const d = a?.background
          ? { ...EMPTY, ...a.background }
          : draftFrom(first);
        setTargetId(first?.id);
        setDraft(d);
        setBg(d);
      })
      .catch((e: Error) => setError((e as Error).message));
  }, [app]);

  const target = targets?.find((t) => t.id === targetId);

  const choose = (t: Target) => {
    setTargetId(t.id);
    setDraft(draftFrom(t));
    setBg(draftFrom(t));
  };

  const remove = async (t: Target) => {
    try {
      await api.removeTarget(t.id);
      const rest = (targets ?? []).filter((x) => x.id !== t.id);
      setTargets(rest);
      if (t.id === targetId) {
        setTargetId(rest[0]?.id);
        setDraft(draftFrom(rest[0]));
        setBg(draftFrom(rest[0]));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (!target) return;
      const p = await api.createProject(target.id, bg);
      setBusyPid(p.id);
      await api.analyze(p.id);
      navigate({ to: "/p/$pid", params: { pid: p.id } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setBusyPid(null);
    }
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

        <Card>
          <CardHeader>
            <CardTitle>1. アプリのコード</CardTitle>
            <p className="text-sm text-muted-foreground">
              登録するとコードのコピーを取り、元のファイルは変えません。
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {targets === null && (
              <p className="text-sm text-muted-foreground">読み込み中…</p>
            )}
            {targets?.length === 0 && (
              <Alert variant="info">
                <AlertTitle>検査するフォルダがありません</AlertTitle>
                <AlertDescription>
                  アプリのフォルダでターミナルを開き、
                  <code>judgineer load</code>{" "}
                  を実行してください。ここに追加されます。
                </AlertDescription>
              </Alert>
            )}
            <ul className="grid gap-2">
              {targets?.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-center gap-2 rounded-md border p-3 ${
                    t.id === targetId ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => choose(t)}
                    aria-pressed={t.id === targetId}
                  >
                    <span className="font-medium">{t.name}</span>
                    {!t.exists && (
                      <span className="ml-2 text-sm text-destructive">
                        見つかりません
                      </span>
                    )}
                    <code className="block truncate text-xs text-muted-foreground">
                      {t.path}
                    </code>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="一覧から外す"
                    onClick={() => remove(t)}
                  >
                    <IconX />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

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
            <div className="grid gap-3 sm:pl-36">
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
                  <Button variant="ghost" onClick={() => setBg(draft)}>
                    下書きに戻す
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <aside>
        <Card size="sm">
          <CardHeader>
            <CardTitle>登録済みのアプリ</CardTitle>
          </CardHeader>
          <CardContent>
            {apps.length === 0 && (
              <p className="text-sm text-muted-foreground">まだありません</p>
            )}
            <ul className="divide-y">
              {apps.slice(0, RECENT).map((a) => (
                <li key={a.id} className="py-2">
                  <Link
                    to="/register"
                    search={{ app: a.id }}
                    className="font-medium hover:underline"
                  >
                    {a.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {a.updated_at.slice(0, 10)}
                  </p>
                </li>
              ))}
            </ul>
            {apps.length > RECENT && (
              <Link to="/" className="mt-2 block text-sm underline">
                すべて見る
              </Link>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
