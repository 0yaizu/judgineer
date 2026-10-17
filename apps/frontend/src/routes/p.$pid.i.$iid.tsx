import { IconPlayerPlayFilled } from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { Issue, Project } from "@tka/shared";
import { useMemo, useState } from "react";
import { ArchDiagram } from "#/components/ArchDiagram";
import { CodeView } from "#/components/CodeView";
import { Crumbs, crumbLinkClass } from "#/components/Crumbs";
import { ErrorBox } from "#/components/ErrorBox";
import { FixView } from "#/components/FixView";
import { LogView } from "#/components/LogView";
import { SkipForm } from "#/components/SkipForm";
import { Alert, AlertTitle } from "#/components/starwind/alert";
import { Badge } from "#/components/starwind/badge";
import { Button } from "#/components/starwind/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/components/starwind/card";
import { RadioGroup, RadioGroupItem } from "#/components/starwind/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/starwind/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#/components/starwind/tabs";
import { Textarea } from "#/components/starwind/textarea";
import {
  decide,
  limitDay,
  MIN_REASON,
  MIN_STANCE,
  saveLesson,
  skipIssue,
  submitStance,
  unskipIssue,
  useStore,
} from "#/lib/store";

export const Route = createFileRoute("/p/$pid/i/$iid")({
  component: IssueRoute,
});

const ROWS = [
  { key: "change_summary", label: "何を変えるか" },
  { key: "security", label: "問題はどこまで解決するか" },
  { key: "effort", label: "手間" },
  { key: "stakeholders", label: "関係者への影響" },
  { key: "operations", label: "入れたあとの運用" },
] as const;

const STEPS = [
  "原因を調べる",
  "自分の方針",
  "修正案を比べる",
  "選んだ理由",
  "修正を反映",
  "振り返り",
];

type Tab = "code" | "infra" | "log";

const SEVERITY_TONE = { 高: "error", 中: "warning", 低: "neutral" } as const;

function IssueRoute() {
  const { pid, iid } = Route.useParams();
  const { projects } = useStore();
  const p = projects.find((x) => x.id === pid);
  const issue = p?.issues.find((x) => x.id === iid);

  if (!p || !issue) {
    return (
      <div className="grid gap-4">
        <ErrorBox message="出来事が見つかりません。" />
        <Link to="/" className="underline">
          アプリを登録する
        </Link>
      </div>
    );
  }
  return <IssuePage key={`${pid}/${iid}`} p={p} issue={issue} />;
}

function IssuePage({ p, issue }: { p: Project; issue: Issue }) {
  const navigate = useNavigate();
  const pid = p.id;
  const iid = issue.id;
  const [stance, setStance] = useState(issue.stance);
  const [pick, setPick] = useState<number | null>(
    issue.decision?.option_index ?? null,
  );
  const [reason, setReason] = useState(issue.decision?.reason ?? "");
  const [lesson, setLesson] = useState(issue.lesson);
  const [redo, setRedo] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(
    issue.view === "infra" ? "infra" : "code",
  );

  // 毎回新しい配列にならないようにする（スクロール位置が入力のたびに戻るため）
  const evidence = useMemo(
    () =>
      p.findings
        .filter((f) => issue.finding_ids.includes(f.id))
        .sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line),
    [p.findings, issue.finding_ids],
  );
  const logLines = useMemo(
    () => issue.signals.map((s, n) => ({ key: String(n), ...s })),
    [issue.signals],
  );
  const hasOptions = issue.options.length > 0 && !redo;
  const hasFeedback = !!issue.feedback && !redo;
  const step = hasFeedback
    ? issue.fix
      ? 5
      : 4
    : hasOptions
      ? pick !== null
        ? 3
        : 2
      : 1;
  const byId = (id?: string) =>
    id ? p.issues.find((x) => x.id === id) : undefined;
  const preventer = byId(issue.prevented_by);
  const origin = byId(issue.escalated_from);
  const escalation = byId(issue.skipped?.escalation_id);
  const skipped = !!issue.skipped && !redo;
  const firstOpenDay = limitDay(p);

  const run = (fn: () => void) => {
    setError("");
    try {
      fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resume = () =>
    navigate({ to: "/p/$pid", params: { pid }, search: { play: true } });

  const onStance = () =>
    run(() => {
      submitStance(pid, iid, stance);
      setPick(null);
      setReason("");
      setLesson("");
      setRedo(false);
    });

  const onDecide = () =>
    run(() => pick !== null && decide(pid, iid, pick, reason));

  const onSkip = (why: string) =>
    run(() => {
      skipIssue(pid, iid, why);
      resume();
    });

  const onLesson = () =>
    run(() => {
      saveLesson(pid, iid, lesson);
    });

  const skipBlock = !issue.feedback && (
    <SkipForm openLabel="この出来事には、今回は対応しない" onSkip={onSkip} />
  );

  return (
    <div className="grid gap-6">
      <Crumbs
        parent={
          <Link to="/p/$pid" params={{ pid }} className={crumbLinkClass}>
            {p.background.title}
          </Link>
        }
        current={`${issue.day}日目の出来事`}
      />

      <ol
        className="flex flex-wrap gap-x-5 gap-y-2 border-b pb-3"
        aria-label="進み具合"
      >
        {STEPS.map((s, n) => (
          <li
            key={s}
            className={`flex items-center gap-2 text-sm ${n === step ? "font-medium" : n < step ? "text-muted-foreground" : "text-muted-foreground/60"}`}
          >
            <span
              className={`flex size-6 items-center justify-center rounded-full border text-xs ${
                n === step
                  ? "border-primary bg-primary text-primary-foreground"
                  : n < step
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : ""
              }`}
            >
              {n + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <Card className="bg-warning/10 ring-warning">
        <CardHeader>
          <Badge variant="warning" size="sm" className="justify-self-start">
            運用 {issue.day}日目に発生
          </Badge>
          <CardTitle className="text-xl leading-snug">
            {issue.incident_title}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="max-w-3xl">{issue.incident_story}</p>
          {origin && (
            <p className="text-sm">
              {origin.day}日目に「{origin.skipped?.reason}
              」という理由で見送った出来事の原因が、直されないまま残っていました。
            </p>
          )}
        </CardContent>
      </Card>

      {preventer && (
        <Alert variant="info">
          <AlertTitle>この出来事は起きませんでした</AlertTitle>
          <div className="grid gap-3">
            <p>
              {preventer.day}日目の修正「
              {preventer.options[preventer.decision?.option_index ?? 0]?.label}
              」で原因が取り除かれていました。{issue.prevented_reason}
            </p>
            <Button variant="primary" className="self-start" onClick={resume}>
              運用に戻る <IconPlayerPlayFilled />
            </Button>
          </div>
        </Alert>
      )}

      {skipped && (
        <Alert>
          <AlertTitle>この出来事は、今回は対応しないことにしました</AlertTitle>
          <div className="grid gap-3">
            <p>見送った理由：{issue.skipped?.reason}</p>
            <p>
              {issue.skipped?.impact === "none" ? (
                `放っておいても運用への影響は小さいと見込まれています。${issue.skipped.impact_reason}`
              ) : escalation && firstOpenDay >= escalation.day ? (
                <>
                  見送った結果、{escalation.day}
                  日目に影響が大きくなって表に出ました。{" "}
                  <Link
                    to="/p/$pid/i/$iid"
                    params={{ pid, iid: escalation.id }}
                    className="underline"
                  >
                    {escalation.day}日目の出来事を見る
                  </Link>
                </>
              ) : (
                "見送った影響は、この先の運用で表に出るかもしれません。"
              )}
            </p>
            <ErrorBox message={error} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={resume}>
                運用に戻る <IconPlayerPlayFilled />
              </Button>
              <Button
                variant="secondary"
                onClick={() => run(() => unskipIssue(pid, iid))}
              >
                やっぱり対応する
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <section className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">原因を調べる</h2>
          <span className="text-sm text-muted-foreground">
            根拠: 検出ルール → 該当するコード → 運用でどう表に出たか
          </span>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="code">
              原因のコード
              <Badge variant="ghost" size="sm">
                {evidence.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="infra">構成図で見る</TabsTrigger>
            <TabsTrigger value="log">
              その日のログ
              <Badge variant="ghost" size="sm">
                {issue.signals.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="code" className="pt-3">
            {evidence.length > 0 ? (
              <CodeView code={p.source} findings={evidence} />
            ) : (
              <p className="text-sm text-muted-foreground">
                コードに直接の原因はありません。構成図とログを見てください。
              </p>
            )}
          </TabsContent>
          <TabsContent value="infra" className="grid gap-2 pt-3">
            <ArchDiagram
              arch={p.architecture}
              affected={issue.affected_nodes}
            />
            <p className="text-sm text-muted-foreground">
              赤い枠が、この出来事で影響が出ている部分です。影響あり：
              {issue.affected_nodes
                .map(
                  (id) =>
                    p.architecture.nodes.find((n) => n.id === id)?.label ?? id,
                )
                .join("、") || "なし"}
            </p>
          </TabsContent>
          <TabsContent value="log" className="pt-3">
            <LogView lines={logLines} height={240} />
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge
                tone={SEVERITY_TONE[issue.severity]}
                appearance="soft"
                size="sm"
              >
                影響 {issue.severity}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {issue.category}
              </span>
            </div>
            <CardTitle>原因：{issue.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="max-w-3xl">{issue.what_happens}</p>
            <dl className="grid gap-2 text-sm">
              <div className="grid grid-cols-[8rem_1fr] gap-3 border-t pt-2">
                <dt className="text-muted-foreground">影響を受ける人</dt>
                <dd>{issue.who_is_affected}</dd>
              </div>
              {issue.background_link && (
                <div className="grid grid-cols-[8rem_1fr] gap-3 border-t pt-2">
                  <dt className="text-muted-foreground">関係する背景</dt>
                  <dd>{issue.background_link}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </section>

      {!preventer && !skipped && (
        <>
          <section className="grid gap-3">
            <h2 className="text-lg font-semibold">あなたならどうしますか</h2>
            {hasOptions ? (
              <Quote label="最初に書いた方針">
                {issue.stance}
                {!hasFeedback && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 self-start"
                    onClick={() => setRedo(true)}
                  >
                    書き直す
                  </Button>
                )}
              </Quote>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  修正案を見る前に、自分の考えを書いてください。何を優先するか、誰に確認するかなど、一言でも大丈夫です。
                </p>
                <Textarea
                  className="max-w-3xl"
                  rows={4}
                  value={stance}
                  onChange={(e) => setStance(e.target.value)}
                  placeholder="例: まずは〇〇を止めて、B社には〜と伝える"
                />
                <ErrorBox message={error} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    disabled={stance.trim().length < MIN_STANCE}
                    onClick={onStance}
                  >
                    修正案を見る
                  </Button>
                  {skipBlock}
                </div>
              </>
            )}
          </section>

          {hasOptions && (
            <section className="grid gap-3">
              <h2 className="text-lg font-semibold">修正案を比べる</h2>
              <p className="text-sm text-muted-foreground">
                並び順に意味はありません。どれが良いかはAIは言いません。背景をふまえて選んでください。
              </p>
              <RadioGroup
                legend="修正案"
                value={pick === null ? "" : String(pick)}
                disabled={hasFeedback}
                onValueChange={(v) => setPick(Number(v))}
                className="block overflow-x-auto"
              >
                <Table className="min-w-3xl">
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      {issue.options.map((o, n) => (
                        <TableHead
                          key={o.label}
                          className={pick === n ? "bg-primary/10" : ""}
                        >
                          {/* biome-ignore lint/a11y/noLabelWithoutControl: Starwind のラジオは input ではなく Base UI の要素 */}
                          <label className="flex cursor-pointer items-start gap-2 whitespace-normal">
                            <RadioGroupItem value={String(n)} />案{n + 1}：
                            {o.label}
                          </label>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ROWS.map((r) => (
                      <TableRow key={r.key}>
                        <TableHead scope="row">{r.label}</TableHead>
                        {issue.options.map((o, n) => (
                          <TableCell
                            key={o.label}
                            className={`whitespace-normal align-top ${pick === n ? "bg-primary/10" : ""}`}
                          >
                            {r.key === "change_summary"
                              ? o.change_summary
                              : o.effects[r.key]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </RadioGroup>
              {issue.unknowns.length > 0 && (
                <Alert variant="warning">
                  <AlertTitle>背景からはわからないこと</AlertTitle>
                  <div>
                    <ul className="list-disc pl-5">
                      {issue.unknowns.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      実際の現場なら、選ぶ前に確認したいことです。ここでは自分で仮定を置いて進めてください。
                    </p>
                  </div>
                </Alert>
              )}
            </section>
          )}

          {hasOptions && (
            <section className="grid gap-3">
              <h2 className="text-lg font-semibold">選んだ理由</h2>
              {hasFeedback && issue.decision ? (
                <Quote
                  label={`案${issue.decision.option_index + 1}「${issue.options[issue.decision.option_index].label}」を選んだ理由`}
                >
                  {issue.decision.reason}
                </Quote>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {pick === null
                      ? "上の表で案を1つ選んでください。"
                      : `案${pick + 1}「${issue.options[pick].label}」を選んだ理由を書いてください。`}
                  </p>
                  <Textarea
                    className="max-w-3xl"
                    rows={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={pick === null}
                    placeholder="何を優先して、何をあきらめたか"
                  />
                  <ErrorBox message={error} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="primary"
                      disabled={
                        pick === null || reason.trim().length < MIN_REASON
                      }
                      onClick={onDecide}
                    >
                      この案に決める
                    </Button>
                    {skipBlock}
                  </div>
                </>
              )}
            </section>
          )}

          {hasFeedback && issue.fix && (
            <section className="grid gap-3">
              <h2 className="text-lg font-semibold">修正を反映する</h2>
              <FixView fix={issue.fix} />
            </section>
          )}

          {hasFeedback && issue.feedback && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">振り返り</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <h3 className="mb-1 text-sm font-semibold">
                    この案を入れると
                  </h3>
                  <p>{issue.feedback.consequence}</p>
                </div>

                {issue.feedback.covered.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold">
                      理由の中で考えられていたこと
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {issue.feedback.covered.map((c) => (
                        <Badge key={c} variant="outline">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="mb-1 text-sm font-semibold">
                    考えてみてほしいこと
                  </h3>
                  <ol className="list-decimal pl-5">
                    {issue.feedback.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ol>
                </div>

                <div className="grid gap-2">
                  <h3 className="text-sm font-semibold">
                    次にアプリを作るときのメモ
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    この判断から、次の開発で気をつけたいことを自分の言葉で残してください。次にアプリを登録したときに表示されます。
                  </p>
                  <Textarea
                    className="max-w-3xl"
                    rows={3}
                    value={lesson}
                    onChange={(e) => setLesson(e.target.value)}
                    placeholder="例: 提携先に渡すAPIキーは、最初から相手ごとに分けて発行する"
                  />
                  <ErrorBox message={error} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={lesson.trim().length === 0}
                      onClick={onLesson}
                    >
                      メモを残す
                    </Button>
                    {issue.lesson && lesson.trim() === issue.lesson && (
                      <span className="text-sm text-green-700 dark:text-green-400">
                        保存しました
                      </span>
                    )}
                    <Button variant="ghost" onClick={() => setRedo(true)}>
                      方針から考え直す
                    </Button>
                    <Button
                      variant="primary"
                      className="ml-auto"
                      onClick={resume}
                    >
                      運用を再開する <IconPlayerPlayFilled />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Quote({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <blockquote className="flex max-w-3xl flex-col gap-1 rounded-lg border-l-4 border-primary bg-muted/50 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </blockquote>
  );
}
