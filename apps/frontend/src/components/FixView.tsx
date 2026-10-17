import { Card, CardContent } from "#/components/starwind/card";
import type { Fix } from "#/lib/types";
import { ArchDiagram } from "./ArchDiagram";
import { DiffView } from "./DiffView";

const edgeKey = (e: { from: string; to: string; label: string }) =>
  `${e.from}>${e.to}:${e.label}`;

function archChanged(fix: Fix): boolean {
  const ids = (a: Fix["arch_before"]) => [
    ...a.nodes.map((n) => `n:${n.id}`),
    ...a.edges.map((e) => `e:${edgeKey(e)}`),
  ];
  const before = new Set(ids(fix.arch_before));
  const after = new Set(ids(fix.arch_after));
  return before.size !== after.size || [...before].some((k) => !after.has(k));
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "good" | "bad";
}) {
  const color =
    value === 0
      ? ""
      : tone === "good"
        ? "text-green-700 dark:text-green-400"
        : "text-error";
  return (
    <Card size="sm">
      <CardContent className={`flex items-baseline gap-2 ${color}`}>
        <b className="text-2xl tabular-nums">{value}</b>
        <span className="text-sm">{label}</span>
      </CardContent>
    </Card>
  );
}

export function FixView({ fix }: { fix: Fix }) {
  const count = (e: string) => fix.effects.filter((x) => x.effect === e).length;
  const changed = archChanged(fix);

  return (
    <div className="grid gap-4">
      <p className="font-medium">{fix.summary}</p>

      <h3 className="text-sm font-semibold">コードの変化</h3>
      <DiffView diffs={fix.diffs} />

      <h3 className="text-sm font-semibold">構成の変化</h3>
      {changed ? (
        <div className="grid gap-3 md:grid-cols-2">
          <figure className="grid gap-1">
            <figcaption className="text-xs text-muted-foreground">
              修正前
            </figcaption>
            <ArchDiagram compact arch={fix.arch_before} />
          </figure>
          <figure className="grid gap-1">
            <figcaption className="text-xs text-muted-foreground">
              修正後
            </figcaption>
            <ArchDiagram compact arch={fix.arch_after} />
          </figure>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">構成は変わりません。</p>
      )}
      {fix.arch_notes.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {fix.arch_notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <h3 className="text-sm font-semibold">この先の運用への影響</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          value={count("prevented")}
          label="件の出来事が起きなくなる"
          tone="good"
        />
        <Stat
          value={count("reduced")}
          label="件の影響が小さくなる"
          tone="good"
        />
        <Stat value={count("worse")} label="件の影響が大きくなる" tone="bad" />
        <Stat
          value={fix.new_issue_ids.length}
          label="件の出来事が新しく起きる"
          tone="bad"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        どの出来事がどう変わったかは、運用を再開して、その日になるとわかります。シークバーに「回避」や新しい出来事として現れます。
      </p>
    </div>
  );
}
