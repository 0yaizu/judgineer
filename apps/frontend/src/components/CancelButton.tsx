import { IconPlayerStopFilled } from "@tabler/icons-react";
import { useState } from "react";
import { api } from "#/lib/api";

/**
 * AI の生成を止めるボタン。押すと、そのセッションで動いている生成 (claude のプロセス) を
 * バックエンドで止める。待っていた側の処理は Cancelled で終わる
 */
export function CancelButton({ pid }: { pid: string }) {
  const [stopping, setStopping] = useState(false);
  return (
    <button
      type="button"
      disabled={stopping}
      onClick={() => {
        setStopping(true);
        // 止められなかったときは、また押せるようにする
        api.cancel(pid).catch(() => setStopping(false));
      }}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-error/50 bg-background px-4 text-sm font-medium text-error shadow-xs transition-colors hover:bg-error hover:text-error-foreground disabled:pointer-events-none disabled:opacity-60"
    >
      <IconPlayerStopFilled className="size-4" />
      {stopping ? "止めています…" : "生成をキャンセル"}
    </button>
  );
}
