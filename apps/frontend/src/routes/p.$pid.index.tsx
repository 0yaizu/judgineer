import {
  IconChevronDown,
  IconChevronUp,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SIM_DAYS } from "@tka/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button, ButtonVariants } from "#/components/starwind/button";
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
import { useDetail } from "#/lib/useDetail";
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

const signalLogs = (i: Issue): LogLine[] =>
  i.signals.map((s, n) => ({
    key: `s${i.id}${n}${seq++}`,
    time: `${i.day}日目 ${s.time}`,
    source: s.source,
    level: s.level,
    text: s.text,
  }));

function incidentLogs(i: Issue): LogLine[] {
  return [
    {
      key: `h${i.id}${seq++}`,
      time: `${i.day}日目`,
      source: "────",
      level: "error",
      text: `出来事が発生：${i.incident_title}`,
    },
    ...signalLogs(i),
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
  const [seekbarOpen, setSeekbarOpen] = useState(true);
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
  const currentId = current?.id;
  // 出来事のログは本文が無いまま先に出ているので、本文が届いたら signals を足す
  const onDetail = useCallback(
    (np: Project) => {
      onChange(np);
      const d = np.issues.find((i) => i.id === currentId);
      if (d) setLogs((l) => appendLog(l, ...signalLogs(d)));
    },
    [onChange, currentId],
  );
  const detail = useDetail(p, atIncident ? current : undefined, onDetail);
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
            <h1 className="mt-1.5 mb-0.5 text-[26px] leading-snug font-bold">
              {p.background.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              公開から{SIM_DAYS}
              日間の運用を再生します。問題は、その日になるまで見えません。
            </p>
          </div>
          <dl className="flex gap-7">
            <Stat label="運用" value={today} unit="日目" />
            <Stat label="起きた出来事" value={reached.length} />
            <Stat label="対応済み" value={done} />
            <Stat label="修正で回避" value={avoided} />
          </dl>
        </div>
      </div>

      <ErrorBox message={error} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="grid gap-3 rounded-[10px] border bg-card px-[18px] pt-4 pb-[18px]">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-sub">システム構成</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${atIncident ? "bg-warn-tint font-medium text-error" : "bg-tint text-primary-accent"}`}
            >
              {playing && <Spinner className="size-3" />}
              {atIncident ? "異常あり" : playing ? "稼働中" : "停止中"}
            </span>
          </div>
          <ArchDiagram
            compact
            arch={p.architecture}
            affected={atIncident ? current.affected_nodes : []}
            liveEdges={playing ? liveEdges : []}
          />
          <LogView title="運用ログ" lines={logs} height={200} />
        </section>

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
            <div className="grid animate-in gap-3 rounded-[10px] border-2 border-error bg-warn-tint px-[18px] py-4 text-sm fade-in slide-in-from-bottom-1">
              <div>
                <p className="text-xs font-bold tracking-wider text-error">
                  {current.day}日目に発生
                </p>
                <h2 className="mt-1 text-[17px] leading-relaxed font-bold">
                  {current.incident_title}
                </h2>
              </div>
              <p>{current.incident_story}</p>
              {origin && (
                <p className="rounded-md bg-background/70 p-2">
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
            </div>
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
            <div>
              <h3 className="mb-1.5 text-[13px] font-bold text-sub">
                これまでの出来事
              </h3>
              <ol className="divide-y divide-line-soft border-y border-line-soft">
                {reached.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-start justify-between gap-2.5 py-2"
                  >
                    <Link
                      to="/p/$pid/i/$iid"
                      params={{ pid, iid: i.id }}
                      className="flex min-w-0 flex-col text-[13px] leading-normal text-foreground hover:text-foreground hover:underline"
                    >
                      <span className="text-xs text-muted-foreground">
                        {i.day}日目
                      </span>
                      {i.incident_title}
                    </Link>
                    <StatusBadge i={i} />
                  </li>
                ))}
              </ol>
            </div>
          )}

          {related.length > 0 && (
            <div className="rounded-md bg-tint px-5 py-4">
              <h3 className="mb-1.5 text-[13px] font-bold text-sub">
                前に作ったアプリでのメモ
              </h3>
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
            </div>
          )}

          <Accordion
            type="single"
            collapsible
            className="rounded-md border px-4"
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

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90">
        {/* 開閉は 0.5 秒かけて、高さと透明度を変える（見えていない側は操作できないようにする） */}
        <div
          inert={!seekbarOpen}
          className={`grid transition-[grid-template-rows,opacity] duration-500 ease-in-out ${seekbarOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        >
          <div className="overflow-hidden">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-0 right-1 z-10 size-6"
                aria-label="シークバーを最小化する"
                aria-expanded
                onClick={() => setSeekbarOpen(false)}
              >
                <IconChevronDown />
              </Button>
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
          </div>
        </div>
        <div
          inert={seekbarOpen}
          className={`grid transition-[grid-template-rows,opacity] duration-500 ease-in-out ${seekbarOpen ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
        >
          <div className="overflow-hidden">
            <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-1.5 sm:px-6">
              <Button
                variant="primary"
                size="icon-sm"
                className="size-8 rounded-full"
                onClick={toggle}
                aria-label={playing ? "一時停止" : "再生"}
                disabled={day >= SIM_DAYS}
              >
                {playing ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />}
              </Button>
              <span className="text-sm tabular-nums">
                <b>{Math.floor(day)}</b>
                <span className="text-muted-foreground">
                  {" "}
                  日目 / {SIM_DAYS}日
                </span>
              </span>
              {openIssue && (
                <span className="text-xs text-error">
                  {openIssue.day}日目の出来事が未対応です
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto size-7"
                aria-label="シークバーを開く"
                aria-expanded={false}
                onClick={() => setSeekbarOpen(true)}
              >
                <IconChevronUp />
              </Button>
            </div>
          </div>
        </div>
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
    <div className="flex items-baseline gap-1">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <b className="text-[28px] leading-none tabular-nums">{value}</b>
        {unit && (
          <span className="text-[13px] text-muted-foreground">{unit}</span>
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
    <div className="grid gap-3 rounded-[10px] border px-[18px] py-4 text-sm">
      <div>
        {badge && (
          <p className="text-xs font-bold tracking-wider text-sub">{badge}</p>
        )}
        <h2 className="mt-1 text-base leading-relaxed font-bold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

const STATUS: Record<IssueState, { text: string; className: string }> = {
  avoided: { text: "回避", className: "font-medium text-primary" },
  done: { text: "対応済み", className: "font-medium text-primary" },
  skipped: { text: "見送り", className: "text-sub" },
  open: { text: "未対応", className: "font-medium text-error" },
};

function StatusBadge({ i }: { i: Issue }) {
  const { text, className } = STATUS[issueState(i)];
  return (
    <span className={`shrink-0 text-xs whitespace-nowrap ${className}`}>
      {text}
    </span>
  );
}
