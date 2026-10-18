import {
  IconArrowRight,
  IconChevronDown,
  IconChevronUp,
  IconFolder,
  IconPencil,
  IconSearch,
} from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ErrorBox } from "#/components/ErrorBox";
import { PageHeader, panelClass, pillClass } from "#/components/Page";
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

const RECENT = 5;

type Field = {
  key: keyof Background;
  label: string;
  hint: string;
  rows: number;
};

// 入力欄は、書く順に考えやすいまとまりに分ける
const GROUPS: { title: string; note: string; fields: Field[] }[] = [
  {
    title: "基本",
    note: "あとから一覧で見分けられる名前にしてください。",
    fields: [
      {
        key: "title",
        label: "アプリ名",
        hint: "例: A社 顧客データ提供API",
        rows: 1,
      },
    ],
  },
  {
    title: "関係者とデータ",
    note: "誰が使い、どんなデータがどこへ流れるか。修正の影響を考える土台になります。",
    fields: [
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
    ],
  },
  {
    title: "運用の前提",
    note: "止められるか、誰が直せるか。判断の分かれ目になる事情です。",
    fields: [
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
    ],
  },
];
const FIELDS = GROUPS.flatMap((g) => g.fields);

// 登録したあとに起きること
const NEXT_STEPS = [
  { title: "コードを調べる", note: "危ないところを洗い出します" },
  {
    title: "運用の台本を作る",
    note: "公開後に起きる出来事を用意します（1〜2分）",
  },
  { title: "出来事に対応する", note: "早送りの運用の中で、自分で判断します" },
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

  const filled = FIELDS.filter((f) => bg[f.key].trim()).length;
  const ready = !!target?.exists && !!bg.title.trim();
  // 押せない理由。フォルダを読み込み中は理由を出さない
  const blocked = !target
    ? ""
    : !target.exists
      ? "検査するフォルダが見つかると、作れるようになります"
      : !bg.title.trim()
        ? "アプリ名を入れると、作れるようになります"
        : "";
  const editing = app ? apps.find((a) => a.id === app) : undefined;

  return (
    <div>
      <PageHeader eyebrow="REGISTER" title="アプリを登録する">
        完成したアプリと、その背景を教えてください。公開後の運用を早送りで再生し、途中で起きる出来事に自分で対応していきます。
      </PageHeader>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-8">
          {editing && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-tint px-4 py-3 text-sm text-primary-accent">
              <IconPencil className="size-4" />
              登録済みの「{editing.title}
              」の内容を入れています。書き換えて、もう一度シミュレーションできます。
            </p>
          )}

          <Section n={1} title="アプリのコード">
            <div className={`${panelClass} flex items-start gap-4 p-5`}>
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                  target && !target.exists
                    ? "bg-warn-tint text-error"
                    : "bg-tint text-primary"
                }`}
              >
                <IconFolder className="size-5" />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                {target ? (
                  <>
                    <p className="flex items-center gap-2 font-medium">
                      <span
                        className={`size-2 rounded-full ${target.exists ? "bg-primary" : "bg-error"}`}
                      />
                      {target.exists
                        ? "検査するフォルダ"
                        : "検査するフォルダが見つかりません"}
                    </p>
                    <code className="mt-1 block font-mono text-xs break-all text-sub">
                      {target.dir}
                    </code>
                    <p className="mt-2 text-xs text-muted-foreground">
                      登録するとコードのコピーを取り、元のファイルは変えません。別のアプリにするときは、環境変数
                      TARGET_DIR を変えて起動し直してください。
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">読み込み中…</p>
                )}
              </div>
            </div>
          </Section>

          <Section
            n={2}
            title="アプリの背景"
            aside={
              <span className="text-xs text-muted-foreground tabular-nums">
                {filled} / {FIELDS.length} 項目
              </span>
            }
          >
            <p className="-mt-1 mb-4 text-sm text-sub">
              AIはコードしか見られません。どちらの修正が良いかは、ここに書いた事情で変わります。
            </p>
            <div className="grid gap-4">
              {GROUPS.map((g) => (
                <fieldset key={g.title} className={`${panelClass} p-6`}>
                  <legend className="sr-only">{g.title}</legend>
                  <p className="font-display font-extrabold">{g.title}</p>
                  <p className="mt-0.5 mb-5 text-xs text-muted-foreground">
                    {g.note}
                  </p>
                  <div className="grid gap-5">
                    {g.fields.map((f) => (
                      <div key={f.key} className="grid gap-1.5">
                        <Label
                          htmlFor={f.key}
                          className="flex items-center gap-2 text-sm font-medium"
                        >
                          {f.label}
                          {f.key === "title" ? (
                            <span className="rounded-full bg-primary px-2 py-px text-[10px] font-semibold text-primary-foreground">
                              必須
                            </span>
                          ) : (
                            <span className="text-[11px] font-normal text-muted-foreground">
                              任意
                            </span>
                          )}
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
                            onChange={(e) =>
                              setBg({ ...bg, [f.key]: e.target.value })
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </Section>

          <div
            className={`${panelClass} grid gap-4 bg-gradient-to-br from-card to-tint p-6`}
          >
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
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <button
                  type="button"
                  className={pillClass}
                  disabled={!ready}
                  onClick={submit}
                >
                  運用シミュレーションを作る
                  <IconArrowRight />
                </button>
                <Button variant="ghost" onClick={() => setBg(draft)}>
                  下書きに戻す
                </Button>
                {blocked && (
                  <span className="text-xs text-muted-foreground">
                    {blocked}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="grid gap-6 lg:sticky lg:top-24">
          <div className={`${panelClass} p-6`}>
            <p className="text-[11px] font-semibold tracking-[0.3em] text-primary">
              NEXT
            </p>
            <p className="mt-1 font-display font-extrabold">
              登録したあとの流れ
            </p>
            <ol className="mt-5 grid gap-5">
              {NEXT_STEPS.map((st, n) => (
                <li key={st.title} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-background">
                    {n + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{st.title}</p>
                    <p className="text-xs text-muted-foreground">{st.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {apps.length > 0 && <AppPicker apps={apps} current={app} />}
        </aside>
      </div>
    </div>
  );
}

/** 登録済みのアプリから選ぶ。ふだんは最近の数件、「すべて見る」で全件を探せる */
function AppPicker({
  apps,
  current,
}: {
  apps: AppSummary[];
  current?: string;
}) {
  // 選んでいるアプリが最近の数件に無いときは、最初から全件を出す
  const [all, setAll] = useState(
    () => !!current && !apps.slice(0, RECENT).some((a) => a.id === current),
  );
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = all
    ? apps.filter((a) => !q || a.title.toLowerCase().includes(q))
    : apps.slice(0, RECENT);

  return (
    <div className={`${panelClass} p-6`}>
      <p className="font-display text-sm font-extrabold">登録済みのアプリ</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        選ぶと、その内容を入れて書き直せます
      </p>

      {all && (
        <label className="relative mt-4 block animate-in duration-300 fade-in">
          <span className="sr-only">アプリを探す</span>
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="アプリ名で探す"
            // biome-ignore lint/a11y/noAutofocus: 「すべて見る」を押したら、すぐ探せるようにする
            autoFocus
            className="h-9 w-full rounded-full border border-input bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-0"
          />
        </label>
      )}

      <ul
        className={`mt-3 grid ${all ? "max-h-80 overflow-y-auto overscroll-contain pr-1" : ""}`}
      >
        {shown.map((a) => (
          <li key={a.id}>
            <Link
              to="/register"
              search={{ app: a.id }}
              className={`group mx-0 flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted hover:text-foreground ${a.id === current ? "bg-tint" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {a.updated_at.slice(0, 10).replaceAll("-", ".")}
                </span>
              </span>
              <IconArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          </li>
        ))}
        {all && shown.length === 0 && (
          <li className="py-4 text-center text-xs text-muted-foreground">
            「{query}」に当てはまるアプリはありません
          </li>
        )}
      </ul>

      {apps.length > RECENT && (
        <button
          type="button"
          onClick={() => {
            setAll(!all);
            setQuery("");
          }}
          className="mt-3 flex w-full items-center justify-center gap-1 rounded-full border py-1.5 text-xs text-sub transition-colors hover:border-primary/40 hover:text-primary"
        >
          {all ? (
            <>
              最近のものだけにする
              <IconChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              すべて見る（{apps.length}件）
              <IconChevronDown className="size-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function Section({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 font-display text-lg font-extrabold">
          <span className="text-sm font-semibold tracking-[0.2em] text-primary tabular-nums">
            {String(n).padStart(2, "0")}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
