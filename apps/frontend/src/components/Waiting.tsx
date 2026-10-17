import { useEffect, useState } from "react";
import { Spinner } from "#/components/starwind/spinner";
import { api } from "#/lib/api";
import type { Progress } from "#/lib/types";

/** AI を待っている間の表示。pid を渡すと、台本づくりの段階を1秒ごとに聞いて出す */
export function Waiting({ text, pid }: { text: string; pid?: string }) {
  const [sec, setSec] = useState(0);
  const [info, setInfo] = useState<Progress | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setSec((s) => s + 1);
      if (pid)
        api
          .progress(pid)
          .then(setInfo)
          .catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [pid]);

  const stage = info?.stage ? `(${info.step}/${info.total}) ${info.stage}` : "";
  return (
    <output className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      <span className="text-foreground">{stage || text}</span>
      {!!info?.chars && <span>{info.chars.toLocaleString()}文字</span>}
      <span>経過{sec}秒</span>
    </output>
  );
}
