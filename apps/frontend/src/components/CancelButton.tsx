import { IconX } from "@tabler/icons-react";
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
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs text-sub transition-colors hover:border-error/50 hover:text-error disabled:pointer-events-none disabled:opacity-60"
    >
      <IconX className="size-3.5" />
      {stopping ? "止めています…" : "キャンセル"}
    </button>
  );
}
