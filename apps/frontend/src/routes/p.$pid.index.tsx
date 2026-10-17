import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SIM_DAYS } from "@tka/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArchDiagram } from "#/components/ArchDiagram";
import { Crumbs, crumbLinkClass } from "#/components/Crumbs";
import { ErrorBox } from "#/components/ErrorBox";
import { type LogLine, LogView } from "#/components/LogView";
import { type Marker, Seekbar } from "#/components/Seekbar";
import { SkipForm } from "#/components/SkipForm";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/starwind/accordion";
import { Badge } from "#/components/starwind/badge";
import { Button, ButtonVariants } from "#/components/starwind/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/components/starwind/card";
import { Spinner } from "#/components/starwind/spinner";
import { Waiting } from "#/components/Waiting";
import { api } from "#/lib/api";
import {
  chosenLabel,
  type IssueState,
  isSettled,
  issueState,
  limitDay,
} from "#/lib/judge";
import type { Issue, ProjectView as Project } from "#/lib/types";
import { useProject } from "#/lib/useProject";

const setSimDay = (pid: string, day: number) =>
  api.setSimDay(pid, day).catch(() => {});

export const Route = createFileRoute("/p/$pid/")({
  validateSearch: (s: Record<string, unknown>): { play?: boolean } =>
    s.play ? { play: true } : {},
  component: SimulationRoute,
});

const BG_LABELS: [keyof Project["background"], string][] = [
  ["stakeholders", "関係者"],
  ["data_flow", "データの流れ"],
  ["data_types", "扱うデータ"],
  ["constraints", "契約・制約"],
  ["team", "チームの体制"],
  ["notes", "その他"],
];

const MAX_LOGS = 60;
const TICK_MS = { 1: 260, 3: 80 } as const;
const MESSAGE_MS = 4000;

let seq = 0;

const appendLog = (logs: LogLine[], ...added: LogLine[]) =>
  [...logs, ...added].slice(-MAX_LOGS);
const pad = (n: number) => String(n).padStart(2, "0");

// 平常時のログ。(day, seq) から決まるので、乱数は使わない
function normalLog(
  p: Project,
  day: number,
): { line: LogLine; edge: number } | null {
  const edges = p.architecture.edges;
  if (edges.length === 0) return null;
  const name = (id: string) =>
    p.architecture.nodes.find((n) => n.id === id)?.label ?? id;
  const edge = (day * 7 + seq) % edges.length;
  const e = edges[edge];
  seq++;
  return {
    edge,
    line: {
      key: `n${seq}`,
      time: `${day}日目 ${pad(6 + ((day * 5 + seq) % 15))}:${pad((day * 13 + seq * 7) % 60)}`,
      source: "通信",
      level: "ok",
      text: `${name(e.from)} → ${name(e.to)}  ${e.label}  正常`,
    },
  };
}

function incidentLogs(i: Issue): LogLine[] {
  return [
    {
      key: `h${i.id}${seq++}`,
      time: `${i.day}日目`,
      source: "────",
      level: "error",
      text: `出来事が発生：${i.incident_title}`,
    },
    ...i.signals.map((s, n) => ({
      key: `s${i.id}${n}${seq++}`,
      time: `${i.day}日目 ${s.time}`,
      source: s.source,
      level: s.level,
      text: s.text,
    })),
  ];
}

function SimulationRoute() {
  const { pid } = Route.useParams();
  const { play } = Route.useSearch();
  const { project: p, setProject, error } = useProject(pid);

  if (!p) {
    return (
      <div className="grid gap-4">
        {error ? (
          <>
            <ErrorBox message={error} />
            <Link to="/" className="underline">
              アプリを登録する
            </Link>
          </>
        ) : (
          <Waiting text="読み込み中" />
        )}
      </div>
    );
  }
  return <Simulation key={pid} p={p} onChange={setProject} autoplay={!!play} />;
}

function Simulation({
  p,
  onChange,
  autoplay,
}: {
  p: Project;
  onChange: (p: Project) => void;
  autoplay: boolean;
}) {
  const navigate = useNavigate();
  const pid = p.id;
  const issues = useMemo(
    () => [...p.issues].sort((a, b) => a.day - b.day),
    [p.issues],
  );
  const openIssue = issues.find((i) => !isSettled(i));
  const limit = limitDay(issues, SIM_DAYS);
  const [busy, setBusy] = useState(false);

  const [day, setDay] = useState(Math.min(p.sim_day, limit));
  const [playing, setPlaying] = useState(
    () => autoplay && (!openIssue || openIssue.day > p.sim_day),
  );
  const [speed, setSpeed] = useState<1 | 3>(1);
  const [logs, setLogs] = useState<LogLine[]>(() =>
    issues
      .filter((i) => i.day <= p.sim_day)
      .slice(-2)
      .flatMap(incidentLogs),
  );
  const [liveEdges, setLiveEdges] = useState<number[]>([]);
  const [error, setError] = useState("");
  const dayRef = useRef(Math.min(p.sim_day, limit));
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const today = Math.floor(day);
  const current = issues.find((i) => i.day === today);
  const reached = issues.filter((i) => i.day <= today);
  const done = reached.filter((i) => i.feedback).length;
  const avoided = reached.filter((i) => i.prevented_by).length;
  const skippedCount = reached.filter((i) => i.skipped).length;

  useEffect(
    () => () => {
      clearTimeout(errorTimer.current);
      setSimDay(pid, dayRef.current);
    },
    [pid],
  );

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const next = dayRef.current + 1;
      if (next >= limit) {
        dayRef.current = limit;
        setDay(limit);
        setPlaying(false);
        setLiveEdges([]);
        const hit = issues.find((i) => i.day === limit);
        if (hit) setLogs((l) => appendLog(l, ...incidentLogs(hit)));
        setSimDay(pid, limit);
        return;
      }
      dayRef.current = next;
      setDay(next);
      const avoidedToday = issues.find((i) => i.day === next && i.prevented_by);
      if (avoidedToday) {
        const by = issues.find((i) => i.id === avoidedToday.prevented_by);
        setLogs((l) =>
          appendLog(l, {
            key: `av${seq++}`,
            time: `${next}日目`,
            source: "回避",
            level: "ok" as const,
            text: `起きるはずだった出来事「${avoidedToday.incident_title}」は、${by ? `${by.day}日目の` : ""}修正で起きませんでした`,
          }),
        );
      }
      const n = normalLog(p, next);
      if (n) {
        setLiveEdges([n.edge]);
        setLogs((l) => appendLog(l, n.line));
      }
    }, TICK_MS[speed]);
    return () => clearInterval(t);
  }, [playing, speed, limit, issues, p, pid]);

  const seek = (d: number) => {
    setPlaying(false);
    dayRef.current = d;
    setDay(d);
    setLiveEdges([]);
    setLogs([
      ...issues
        .filter((i) => i.day <= d)
        .slice(-2)
        .flatMap(incidentLogs),
      {
        key: `seek${seq++}`,
        time: `${d}日目`,
        source: "────",
        level: "info",
        text: `${d}日目に移動しました`,
      },
    ]);
    setSimDay(pid, d);
  };

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      setSimDay(pid, dayRef.current);
    } else if (day < limit) {
      setPlaying(true);
    } else if (openIssue) {
      setError(
        `${openIssue.day}日目の出来事に対応するか見送るまで、運用は先に進みません。右のカードから選んでください。`,
      );
      clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setError(""), MESSAGE_MS);
    }
  };

  const markers: Marker[] = reached.map((i) => ({
    day: i.day,
    state: issueState(i),
    label: i.incident_title,
    onClick: () => seek(i.day),
  }));

  const skip = async (target: Issue, reason: string) => {
    setBusy(true);
    try {
      onChange(await api.skip(pid, target.id, reason));
      setLogs((l) =>
        appendLog(l, {
          key: `sk${seq++}`,
          time: `${target.day}日目`,
          source: "見送り",
          level: "info" as const,
          text: `「${target.incident_title}」には今回は対応しないことにした（理由：${reason.trim()}）`,
        }),
      );
      setError("");
      setPlaying(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  // 台本がまだ無い（台本づくりが途中で失敗した）ときに作り直す
  const reanalyze = async () => {
    setBusy(true);
    setError("");
    try {
      onChange(await api.analyze(pid));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const atIncident = current && !isSettled(current);
  const origin = current?.escalated_from
    ? issues.find((i) => i.id === current.escalated_from)
    : undefined;
  const escalation = current?.skipped?.escalation_id
    ? issues.find((i) => i.id === current.skipped?.escalation_id)
    : undefined;
  const currentBy = current?.prevented_by
    ? issues.find((i) => i.id === current.prevented_by)
    : undefined;
  const finished = today >= SIM_DAYS && !openIssue;
  const related = p.related_lessons.slice(0, 3);
  const noScript = issues.length === 0 && !p.analyzed_by;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Crumbs
          parent={
            <Link to="/" className={crumbLinkClass}>
              アプリを登録
            </Link>
          }
          current={p.background.title}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{p.background.title}</h1>
            <p className="text-sm text-muted-foreground">
              公開から{SIM_DAYS}
              日間の運用を再生します。問題は、その日になるまで見えません。
            </p>
          </div>
          <dl className="flex gap-3">
            <Stat label="運用" value={today} unit="日目" />
            <Stat label="起きた出来事" value={reached.length} />
            <Stat label="対応済み" value={done} />
            <Stat label="修正で回避" value={avoided} />
          </dl>
        </div>
      </div>

      <ErrorBox message={error} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>システム構成</CardTitle>
            <Badge variant={atIncident ? "error" : "ghost"} size="sm">
              {playing && <Spinner className="size-3" />}
              {atIncident ? "異常あり" : playing ? "稼働中" : "停止中"}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ArchDiagram
              compact
              arch={p.architecture}
              affected={atIncident ? current.affected_nodes : []}
              liveEdges={playing ? liveEdges : []}
            />
            <LogView title="運用ログ" lines={logs} height={200} />
          </CardContent>
        </Card>

        <aside className="grid gap-4">
          {noScript ? (
            <CalmCard title="運用の台本がまだありません">
              <p>
                台本づくりが途中で止まったようです。作り直すと再生できます（1〜2分）。
              </p>
              {busy ? (
                <Waiting text="台本を作っています" pid={pid} />
              ) : (
                <Button variant="primary" onClick={reanalyze}>
                  台本を作り直す
                </Button>
              )}
            </CalmCard>
          ) : atIncident ? (
            <Card className="ring-error">
              <CardHeader>
                <Badge variant="error" size="sm" className="justify-self-start">
                  {current.day}日目に発生
                </Badge>
                <CardTitle className="leading-snug">
                  {current.incident_title}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <p>{current.incident_story}</p>
                {origin && (
                  <p className="rounded-md bg-muted p-2">
                    {origin.day}
                    日目に見送った出来事の原因が、そのまま残っていました。
                  </p>
                )}
                <p className="text-muted-foreground">
                  対応するか、今回は見送るかを決めるまで、運用は先に進みません。
                </p>
                <Button
                  variant="primary"
                  onClick={() =>
                    navigate({
                      to: "/p/$pid/i/$iid",
                      params: { pid, iid: current.id },
                    })
                  }
                >
                  原因を調べて対応する
                </Button>
                <SkipForm
                  openLabel="今回は対応しない"
                  onSkip={(reason) => skip(current, reason)}
                />
              </CardContent>
            </Card>
          ) : current?.prevented_by ? (
            <CalmCard
              badge={`${current.day}日目・修正で回避`}
              title={current.incident_title}
            >
              <p>
                本来はこの日に起きるはずでした。
                {currentBy
                  ? `${currentBy.day}日目の修正「${chosenLabel(currentBy)}」`
                  : "前の修正"}
                で原因が取り除かれていたため、起きませんでした。
              </p>
              {current.prevented_reason && (
                <p className="text-muted-foreground">
                  {current.prevented_reason}
                </p>
              )}
            </CalmCard>
          ) : current?.skipped ? (
            <CalmCard
              badge={`${current.day}日目の出来事・見送り`}
              title={current.incident_title}
            >
              <p>見送った理由：{current.skipped.reason}</p>
              <p className="text-muted-foreground">
                {current.skipped.impact === "none"
                  ? `この出来事は、放っておいても運用への影響は小さいと見込まれています。${current.skipped.impact_reason}`
                  : escalation && limit >= escalation.day
                    ? `見送った結果、${escalation.day}日目に影響が大きくなって表に出ました。`
                    : "見送った影響は、この先の運用で表に出るかもしれません。"}
              </p>
              <Link
                to="/p/$pid/i/$iid"
                params={{ pid, iid: current.id }}
                className="underline"
              >
                判断を見返す・やっぱり対応する
              </Link>
            </CalmCard>
          ) : current?.feedback ? (
            <CalmCard
              badge={`${current.day}日目の出来事・対応済み`}
              title={current.incident_title}
            >
              <Link
                to="/p/$pid/i/$iid"
                params={{ pid, iid: current.id }}
                className="underline"
              >
                判断を見返す
              </Link>
            </CalmCard>
          ) : finished ? (
            <CalmCard title={`${SIM_DAYS}日間の運用が終わりました`}>
              <p>
                {done}件の出来事に対応
                {skippedCount > 0 ? `、${skippedCount}件を見送り` : ""}
                ました。判断の記録から、それぞれの判断と次へのメモを見返せます。
              </p>
              <Link
                to="/lessons"
                className={ButtonVariants.button({ variant: "secondary" })}
              >
                判断の記録を見る
              </Link>
            </CalmCard>
          ) : today === 0 ? (
            <CalmCard title="公開日です">
              <p>
                ▶
                を押すと運用が始まります。何が起きるかは、その日になるまでわかりません。
              </p>
              <Button variant="primary" onClick={() => setPlaying(true)}>
                運用を始める
              </Button>
            </CalmCard>
          ) : (
            <CalmCard title={playing ? "運用中" : "一時停止中"}>
              <p className="text-muted-foreground">
                {playing ? "通信は正常です。" : "▶ で再開します。"}
              </p>
            </CalmCard>
          )}

          {reached.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>これまでの出来事</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="divide-y">
                  {reached.map((i) => (
                    <li
                      key={i.id}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <Link
                        to="/p/$pid/i/$iid"
                        params={{ pid, iid: i.id }}
                        className="min-w-0 hover:underline"
                      >
                        <span className="mr-2 text-muted-foreground">
                          {i.day}日目
                        </span>
                        {i.incident_title}
                      </Link>
                      <StatusBadge i={i} />
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {related.length > 0 && (
            <Card size="sm" className="bg-primary/5">
              <CardHeader>
                <CardTitle>前に作ったアプリでのメモ</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {related.map((l) => (
                    <li key={l.id}>
                      <span className="text-xs text-muted-foreground">
                        {l.project_title}
                      </span>
                      <p>
                        {l.lesson ||
                          (l.chosen.startsWith("今回は対応しない")
                            ? `見送った（${l.reason}）`
                            : `「${l.chosen}」を選んだ`)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Accordion
            type="single"
            collapsible
            className="rounded-xl border px-4"
          >
            <AccordionItem value="bg">
              <AccordionTrigger>入力した背景</AccordionTrigger>
              <AccordionContent>
                <dl className="grid gap-2 text-sm">
                  {BG_LABELS.map(([k, label]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd>{p.background[k] || "（未記入）"}</dd>
                    </div>
                  ))}
                </dl>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-4 z-10 mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Seekbar
          day={day}
          total={SIM_DAYS}
          limit={limit}
          markers={markers}
          playing={playing}
          speed={speed}
          onToggle={toggle}
          onSpeed={(s) => setSpeed(s === 3 ? 3 : 1)}
          onSeek={seek}
          blockedMessage={
            openIssue
              ? `${openIssue.day}日目の出来事に対応するか見送るまで、先へは進めません`
              : undefined
          }
        />
      </div>
      {atIncident && (
        <div className="sr-only" role="alert">
          {current.day}日目に出来事が発生しました。{current.incident_title}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <div className="min-w-16 rounded-lg border px-3 py-1.5 text-center">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd>
        <b className="text-xl tabular-nums">{value}</b>
        {unit && (
          <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>
        )}
      </dd>
    </div>
  );
}

function CalmCard({
  badge,
  title,
  children,
}: {
  badge?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        {badge && (
          <Badge variant="ghost" size="sm" className="justify-self-start">
            {badge}
          </Badge>
        )}
        <CardTitle className="leading-snug">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

const STATUS: Record<
  IssueState,
  { text: string; tone: "info" | "success" | "neutral" | "error" }
> = {
  avoided: { text: "回避", tone: "info" },
  done: { text: "対応済み", tone: "success" },
  skipped: { text: "見送り", tone: "neutral" },
  open: { text: "未対応", tone: "error" },
};

function StatusBadge({ i }: { i: Issue }) {
  const { text, tone } = STATUS[issueState(i)];
  return (
    <Badge tone={tone} appearance="soft" size="sm" className="shrink-0">
      {text}
    </Badge>
  );
}
