import type { DiffRow, FileDiff } from "#/lib/types";

const ROW_CLASS: Record<DiffRow["type"], string> = {
  hunk: "bg-[#0d1117] py-0.5 font-sans text-xs text-[#8b949e]",
  ctx: "",
  del: "bg-[#ff7b72]/15 [&>span:not(:last-child)]:text-[#ff9b85]",
  add: "bg-[#3fb950]/20 [&>span:not(:last-child)]:text-[#7ee2b8]",
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
          <div
            key={d.file}
            className="overflow-hidden rounded-lg bg-[#161b22] dark:bg-[#0b0f12] dark:ring-1 dark:ring-border"
          >
            <div className="flex justify-between bg-[#0d1117] px-3.5 py-2 font-mono text-[12.5px] text-[#e6edf3]">
              {d.file}
              <span className="flex gap-2">
                <span className="text-[#ff9b85]">−{del}</span>
                <span className="text-[#7ee2b8]">+{add}</span>
              </span>
            </div>
            {d.notes.length > 0 && (
              <ul className="list-disc pt-2 pr-3.5 pb-1 pl-8 text-[13px] text-[#c9d1d9]">
                {d.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <div className="max-h-[380px] overflow-auto py-1.5 font-mono text-[12.5px] leading-[1.65] text-[#c9d1d9]">
              {d.rows.map((r, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: 差分の行は並びがすべて
                  key={i}
                  className={`grid min-w-max grid-cols-[44px_44px_22px_1fr] text-[#6e7681] ${ROW_CLASS[r.type]}`}
                >
                  <span className="pr-2 text-right select-none">
                    {r.old ?? ""}
                  </span>
                  <span className="pr-2 text-right select-none">
                    {r.new ?? ""}
                  </span>
                  <span className="text-center select-none">
                    {SIGN[r.type]}
                  </span>
                  <span
                    className={`pr-4 whitespace-pre ${r.type === "hunk" ? "" : "text-[#c9d1d9]"}`}
                  >
                    {r.text || " "}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-[#f6c9c2]" />
          修正前（消した行）
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-[#bfe8cc]" />
          修正後（足した行）
        </span>
      </p>
    </div>
  );
}
