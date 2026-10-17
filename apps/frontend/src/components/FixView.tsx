import type { Fix } from "@tka/shared";
import { Card, CardContent } from "#/components/starwind/card";
import { DiffView } from "./DiffView";

function Stat({
  value,
  label,
  good,
}: {
  value: number;
  label: string;
  good?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent
        className={`flex items-baseline gap-2 ${good && value > 0 ? "text-green-700 dark:text-green-400" : ""}`}
      >
        <b className="text-2xl tabular-nums">{value}</b>
        <span className="text-sm">{label}</span>
      </CardContent>
    </Card>
  );
}

export function FixView({ fix }: { fix: Fix }) {
  const prevented = fix.effects.filter((e) => e.effect === "prevented");

  return (
    <div className="grid gap-4">
      <p className="font-medium">{fix.summary}</p>

      <h3 className="text-sm font-semibold">コードの変化</h3>
      <DiffView diffs={fix.diffs} />

      <h3 className="text-sm font-semibold">この先の運用への影響</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat value={prevented.length} label="件の出来事が起きなくなる" good />
        <Stat
          value={fix.effects.length - prevented.length}
          label="件の出来事は変わらない"
        />
      </div>
      {prevented.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {prevented.map((e) => (
            <li key={e.issue_id}>
              <b>{e.day}日目の出来事</b>：{e.reason}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        どの出来事がどう変わったかは、運用を再開して、その日になるとわかります。シークバーに「回避」として現れます。
      </p>
    </div>
  );
}
