import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ProjectView } from "./types";

export function useProject(pid: string) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      api
        .project(pid)
        .then((p) => {
          setProject(p);
          setError("");
        })
        .catch((e: Error) => setError(e.message)),
    [pid],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { project, setProject, error, reload };
}
