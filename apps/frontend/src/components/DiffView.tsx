import type { DiffRow, FileDiff } from "@tka/shared";
import { Badge } from "#/components/starwind/badge";

const ROW_CLASS: Record<DiffRow["type"], string> = {
  hunk: "bg-muted text-muted-foreground",
  ctx: "",
  del: "bg-error/10",
  add: "bg-green-500/15",
};

const SIGN = { hunk: "", ctx: "", del: "−", add: "+" };

export function DiffView({ diffs }: { diffs: FileDiff[] }) {
  if (diffs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        コードの変更はありません（設定・運用・連絡など、コード以外での対応です）。
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {diffs.map((d) => {
        const del = d.rows.filter((r) => r.type === "del").length;
        const add = d.rows.filter((r) => r.type === "add").length;
        return (
          <div key={d.file} className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 font-mono text-xs">
              {d.file}
              <span className="ml-auto flex gap-2">
                <Badge variant="error" size="sm">
                  −{del}
                </Badge>
                <Badge variant="success" size="sm">
                  +{add}
                </Badge>
              </span>
            </div>
            {d.notes.length > 0 && (
              <ul className="list-disc border-b px-8 py-2 text-sm">
                {d.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto py-1 font-mono text-xs leading-6">
              {d.rows.map((r, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: 差分の行は並びがすべて
                  key={i}
                  className={`grid min-w-max grid-cols-[2.5rem_2.5rem_1.25rem_1fr] ${ROW_CLASS[r.type]}`}
                >
                  <span className="pr-2 text-right text-muted-foreground">
                    {r.old ?? ""}
                  </span>
                  <span className="pr-2 text-right text-muted-foreground">
                    {r.new ?? ""}
                  </span>
                  <span className="text-center">{SIGN[r.type]}</span>
                  <span className="pr-3 whitespace-pre">{r.text || " "}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-error/30" />
          修正前（消した行）
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-green-500/40" />
          修正後（足した行）
        </span>
      </p>
    </div>
  );
}
