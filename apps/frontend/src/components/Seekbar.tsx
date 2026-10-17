import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/starwind/button";
import { Slider } from "#/components/starwind/slider";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "#/components/starwind/toggle-group";

export type Marker = {
  day: number;
  state: "open" | "done" | "avoided" | "skipped";
  label: string;
  onClick?: () => void;
};

const STATE_TEXT = {
  open: "未対応",
  done: "対応済み",
  avoided: "修正で回避",
  skipped: "見送り",
};
const STATE_MARK = { open: "!", done: "✓", avoided: "◎", skipped: "–" };
const STATE_CLASS = {
  open: "border-error bg-error text-error-foreground",
  done: "border-green-700 bg-green-700 text-white",
  avoided: "border-sky-600 bg-sky-600 text-white",
  skipped: "border-border bg-muted text-muted-foreground",
};

const BLOCKED_MS = 1800;

type Props = {
  day: number;
  total: number;
  /** ここより先へは進めない日（未対応の出来事の日） */
  limit: number;
  markers: Marker[];
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSpeed: (s: number) => void;
  onSeek: (day: number) => void;
  blockedMessage?: string;
};

const monthTicks = (total: number) =>
  Array.from({ length: Math.floor(total / 30) }, (_, n) => ({
    day: (n + 1) * 30,
    label: `${n + 1}か月`,
  }));

export function Seekbar({
  day,
  total,
  limit,
  markers,
  playing,
  speed,
  onToggle,
  onSpeed,
  onSeek,
  blockedMessage,
}: Props) {
  const [blocked, setBlocked] = useState(false);
  const pct = (d: number) => `${(Math.min(d, total) / total) * 100}%`;

  useEffect(() => {
    if (!blocked) return;
    const t = setTimeout(() => setBlocked(false), BLOCKED_MS);
    return () => clearTimeout(t);
  }, [blocked]);

  const seek = (d: number) => {
    if (d > limit) setBlocked(true);
    onSeek(Math.min(d, limit));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
      <Button
        variant="primary"
        size="icon"
        onClick={onToggle}
        aria-label={playing ? "一時停止" : "再生"}
        disabled={day >= total}
      >
        {playing ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />}
      </Button>

      <div className="min-w-20 leading-tight">
        <b className="text-2xl tabular-nums">{Math.floor(day)}</b>
        <span className="ml-1 text-xs text-muted-foreground">
          日目 / {total}日
        </span>
      </div>

      <div className="relative order-last min-w-0 flex-1 basis-full pt-7 pb-5 sm:order-none sm:basis-0">
        <div className="relative">
          <Slider
            variant="primary"
            aria-label="運用の経過日数"
            min={0}
            max={total}
            value={Math.floor(day)}
            onValueChange={(v) => seek(Array.isArray(v) ? v[0] : v)}
          />
          <div
            className="pointer-events-none absolute top-1/2 right-0 h-1.5 -translate-y-1/2 rounded-r-full bg-foreground/15"
            style={{ left: pct(limit) }}
          />
          {markers.map((m) => (
            <button
              key={m.day}
              type="button"
              className={`absolute -top-6 flex size-5 -translate-x-1/2 items-center justify-center rounded-full border text-[10px] font-bold ${STATE_CLASS[m.state]}`}
              style={{ left: pct(m.day) }}
              title={`${m.day}日目：${m.label}`}
              aria-label={`${m.day}日目の出来事：${m.label}（${STATE_TEXT[m.state]}）`}
              onClick={m.onClick}
            >
              {STATE_MARK[m.state]}
            </button>
          ))}
        </div>
        <div className="relative mt-3 h-4 text-[11px] text-muted-foreground">
          <span className="absolute left-0">公開日</span>
          {monthTicks(total).map((t) => (
            <span
              key={t.day}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: pct(t.day) }}
            >
              {t.label}
            </span>
          ))}
        </div>
        {blocked && (
          <div className="absolute right-0 bottom-full mb-1 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow">
            {blockedMessage ?? "先に起きた出来事に対応してください"}
          </div>
        )}
      </div>

      <ToggleGroup
        variant="outline"
        size="sm"
        aria-label="再生速度"
        value={[String(speed)]}
        onValueChange={(v) => v[0] && onSpeed(Number(v[0]))}
      >
        {[1, 3].map((s) => (
          <ToggleGroupItem key={s} value={String(s)}>
            {s}x
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
