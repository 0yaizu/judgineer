import type { AppType } from "@tka/backend/app";
import { hc } from "hono/client";
import type {
  AIConfig,
  Background,
  Issue,
  Lesson,
  Progress,
  ProjectSummary,
  ProjectView,
  Target,
} from "./types";

// パスは hc<AppType> から作る（ルートの書き間違いを型で検出する）。
// $url() は new URL() を使うので、相対の "/" ではなくページのオリジンを基準にする
const origin =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;
const client = hc<AppType>(origin).api;

type Res = { ok: boolean; status: number; json(): Promise<unknown> };

// 途中で接続が切れた（バックエンドは処理を続けているかもしれない）
class Disconnected extends Error {}

// エラーのときはバックエンドの detail をそのまま見せる
async function read<T>(res: Promise<Res>): Promise<T> {
  let r: Res;
  try {
    r = await res;
  } catch {
    throw new Disconnected(
      "バックエンドに接続できません。bun run dev が動いているか確認してください",
    );
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = (body as { detail?: string }).detail;
    if (detail) throw new Error(detail);
    // detail が無い 502〜504 は、開発サーバーの proxy がバックエンドにつながらなかったとき
    if (r.status >= 502 && r.status <= 504) {
      throw new Disconnected(
        "バックエンド（127.0.0.1:3001）に接続できません。バックエンドが起動しているか確認してください",
      );
    }
    throw new Error(`エラーが発生しました（${r.status}）`);
  }
  return body as T;
}

// 本文はルート側で readBody が検査するので、hc の型には載らない。URL だけ hc から作って送る
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

// 台本づくりは1〜2分かかる。待っている間に接続が切れても、バックエンドは処理を続けているので
// 進み具合が消える（＝終わる）まで待ってから、結果を読み直す
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
  target: () => read<Target>(client.target.$get()),
  lessons: () => read<Lesson[]>(client.lessons.$get()),
  projects: () => read<ProjectSummary[]>(client.projects.$get()),
  project: (pid: string) =>
    read<ProjectView>(projectApi.$get({ param: { pid } })),
  createProject: (background: Background) =>
    post<ProjectView>(client.projects.$url(), { background }),
  analyze,
  progress: (pid: string) =>
    read<Progress>(projectApi.progress.$get({ param: { pid } })),
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
