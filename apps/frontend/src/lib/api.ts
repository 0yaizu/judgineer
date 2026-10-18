import type { AppType } from "@tka/backend/app";
import { hc } from "hono/client";
import type {
  AIConfig,
  AppRecord,
  AppSummary,
  Background,
  Issue,
  Lesson,
  Progress,
  ProjectSummary,
  ProjectView,
  Target,
} from "./types";

// $url() は new URL() を使うので、相対の "/" ではなくページのオリジンを基準にする
const origin =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;
const client = hc<AppType>(origin).api;

type Res = { ok: boolean; status: number; json(): Promise<unknown> };

class Disconnected extends Error {}

async function read<T>(res: Promise<Res>): Promise<T> {
  let r: Res;
  try {
    r = await res;
  } catch {
    throw new Disconnected(
      "バックエンドに接続できません。judgineer start（開発時は bun run dev）で起動しているか確認してください",
    );
  }
  let body: unknown;
  try {
    body = await r.json();
  } catch {
    // 本文が読めない: proxy がバックエンドにつながらなかった（502〜504）か、途中で接続が切れた
    if (r.ok || (r.status >= 502 && r.status <= 504)) {
      throw new Disconnected(
        "バックエンドとの接続が切れました。judgineer start（開発時は bun run dev）で起動しているか確認してください",
      );
    }
    throw new Error(`エラーが発生しました（${r.status}）`);
  }
  if (!r.ok) {
    const detail = (body as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `エラーが発生しました（${r.status}）`);
  }
  return body as T;
}

// 本文は hc の型に載らない（ルート側の readBody で検査する）ので、URL だけ hc から作る
const post = <T>(url: URL, data: unknown) =>
  read<T>(
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
  );

const projectApi = client.projects[":pid"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 接続が切れてもバックエンドは台本づくりを続けるので、終わるのを待って読み直す
async function analyze(pid: string): Promise<ProjectView> {
  try {
    return await read<ProjectView>(
      projectApi.analyze.$post({ param: { pid } }),
    );
  } catch (e) {
    if (!(e instanceof Disconnected)) throw e;
    for (let i = 0; i < 300; i++) {
      const pr = await read<Progress>(
        projectApi.progress.$get({ param: { pid } }),
      ).catch(() => null);
      if (pr && pr.stage === null) break;
      await sleep(2000);
    }
    const p = await read<ProjectView>(projectApi.$get({ param: { pid } }));
    if (p.analyzed_by) return p;
    throw e;
  }
}
const issueApi = projectApi.issues[":iid"];
const ip = (pid: string, iid: string) => ({ param: { pid, iid } });

export const api = {
  config: () => read<AIConfig>(client.config.$get()),
  targets: () => read<Target[]>(client.targets.$get()),
  removeTarget: (id: string) =>
    read<{ ok: true }>(client.targets[":id"].$delete({ param: { id } })),
  lessons: () => read<Lesson[]>(client.lessons.$get()),
  apps: () => read<AppSummary[]>(client.apps.$get()),
  app: (id: string) =>
    read<AppRecord>(client.apps[":id"].$get({ param: { id } })),
  projects: () => read<ProjectSummary[]>(client.projects.$get()),
  project: (pid: string) =>
    read<ProjectView>(projectApi.$get({ param: { pid } })),
  createProject: (target_id: string, background: Background) =>
    post<ProjectView>(client.projects.$url(), { target_id, background }),
  analyze,
  progress: (pid: string) =>
    read<Progress>(projectApi.progress.$get({ param: { pid } })),
  issueProgress: (pid: string, iid: string) =>
    read<Progress>(issueApi.progress.$get(ip(pid, iid))),
  setSimDay: (pid: string, day: number) =>
    post<{ sim_day: number; limit: number }>(
      projectApi.sim.$url({ param: { pid } }),
      { day },
    ),
  file: (pid: string, path: string, version: "original" | "current") => {
    const url = projectApi.file.$url({ param: { pid } });
    url.search = new URLSearchParams({ path, version }).toString();
    return read<{ path: string; content: string }>(fetch(url));
  },
  detail: (pid: string, iid: string) =>
    read<Issue>(issueApi.detail.$post(ip(pid, iid))),
  chatStart: (pid: string, iid: string) =>
    read<Issue>(issueApi.chat.start.$post(ip(pid, iid))),
  chat: (pid: string, iid: string, text: string, hint = false) =>
    post<Issue>(issueApi.chat.$url(ip(pid, iid)), { text, hint }),
  commit: (pid: string, iid: string, plan: string, reason: string) =>
    post<{ issue: Issue; project: ProjectView }>(
      issueApi.commit.$url(ip(pid, iid)),
      { plan, reason },
    ),
  skip: (pid: string, iid: string, reason: string) =>
    post<ProjectView>(issueApi.skip.$url(ip(pid, iid)), { reason }),
  unskip: (pid: string, iid: string) =>
    read<ProjectView>(issueApi.unskip.$post(ip(pid, iid))),
};
