import { useEffect, useRef, useState } from "react";
import { api, Cancelled } from "./api";
import type { Issue, ProjectView } from "./types";

/** 出来事の本文が未生成 (空文字) なら、表示する前に作らせて project に反映する */
export function useDetail(
  p: ProjectView,
  issue: Issue | undefined,
  onProject: (p: ProjectView) => void,
) {
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const latest = useRef(p);
  latest.current = p;
  const iid = issue?.id;
  const missing = !!issue && issue.incident_story === "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: tries は再試行の合図
  useEffect(() => {
    setError(""); // 別の出来事に移ったとき、前のエラーを引きずらない
    if (!iid || !missing) return;
    let live = true;
    api
      .detail(p.id, iid)
      .then((d) => {
        if (!live) return;
        const cur = latest.current;
        onProject({
          ...cur,
          issues: cur.issues.map((i) => (i.id === d.id ? d : i)),
        });
      })
      .catch(
        (e: Error) =>
          live &&
          setError(
            e instanceof Cancelled
              ? "出来事の詳細づくりをキャンセルしました。もう一度試すと、作り直します。"
              : e.message,
          ),
      );
    return () => {
      live = false;
    };
  }, [p.id, iid, missing, onProject, tries]);

  return {
    loading: missing && !error,
    error,
    retry: () => setTries((n) => n + 1),
  };
}
