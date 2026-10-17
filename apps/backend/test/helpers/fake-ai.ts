import { afterEach, beforeEach, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { type GenerateOpts, type generate, setAI } from "../../src/ai/client";
import app from "../../src/app";
import { config } from "../../src/config";
import type { Issue, Lesson, Project } from "../../src/types";

export type Payload = Project & { sim_days: number; related_lessons: Lesson[] };

// --- 偽 AI: task で分岐し、返した値は schema で検証する (ずれたらテストが落ちる) ---
// 他モジュールから代入できないので、再代入せず length = 0 で空にする
export const calls: { task: string; system: string; prompt: string }[] = [];
export const findingIds: string[] = [];
export const appPy = readFileSync(join(config.targetDir, "app.py"), "utf8");
const debugLine =
  appPy.split("\n").findIndex((l) => l.includes("debug=True")) + 1;

const signal = (source: string) => ({
  time: "06:12:03",
  source,
  level: "error" as const,
  text: "「検索結果がおかしい」",
});
const incident = (day: number, title: string) => ({
  day,
  incident_title: `${title}の連絡が来た`,
  incident_story: "朝6時に気づいた。",
  signals: [signal("B社から")],
  view: "code" as const,
  affected_nodes: ["api", "no_such_node"],
  title,
  category: "脆弱性" as const,
  severity: "高" as const,
  what_happens: "放っておくと広がる",
  who_is_affected: "B社",
  background_link: "",
});
const senior = (text: string) => ({
  role: "senior" as const,
  name: "先輩",
  text,
});

function chatReply(prompt: string) {
  const said = [...prompt.matchAll(/若手（本人）: (.*)/g)].at(-1)?.[1] ?? "";
  if (prompt.includes("<hint>"))
    return { messages: [senior("ログの2行目を見て")], phase: "investigate" };
  if (said.includes("外から"))
    return { messages: [senior("どこに根拠がある？")], phase: "investigate" };
  if (said.includes("B社が"))
    return {
      messages: [
        {
          role: "stakeholder" as const,
          name: "B社 サポート担当",
          text: "止めないで",
        },
        senior("1"),
        senior("2"),
        senior("3"), // 4件目は切り捨てられる
      ],
      phase: "decide",
    };
  if (said.includes("直す"))
    return {
      messages: [senior("その方針で直してみようか")],
      phase: "ready",
      plan: said,
      reason: "B社への影響を抑えるため",
    };
  if (said.includes("やっぱり"))
    return { messages: [senior("もう一度考えよう")], phase: "decide" };
  if (said.includes("次は"))
    return { messages: [senior("いいね")], phase: "done", lesson: said };
  return { messages: [senior("入れたあとは？")], phase: "reflect" };
}

function reply(o: GenerateOpts<z.ZodType>): unknown {
  switch (o.task) {
    case "arch":
      return {
        architecture: {
          nodes: [
            { id: "api", label: "API", kind: "internal" },
            { id: "db", label: "DB", kind: "db" },
            { id: "partner", label: "B社", kind: "partner" },
          ],
          edges: [
            {
              from: "partner",
              to: "api",
              label: "毎朝取得",
              direction: "both",
              kind: "runtime",
            },
            {
              from: "api",
              to: "db",
              label: "検索",
              direction: "both",
              kind: "runtime",
            },
          ],
        },
      };
    // 既定は候補なし (既存テストの findings と呼び出しの組み合わせを変えないため)
    case "extra_findings":
      return { candidates: [] };
    case "flows_all":
      return {
        flows: [
          {
            actor: "partner",
            title: "B社が前日分を取得する",
            per_day: 1,
            feature_ids: ["f1"],
            steps: [{ from: "partner", to: "api", label: "取得" }],
          },
        ],
        assumed_users: 30,
      };
    case "flows":
      return {
        flows: [
          {
            actor: "partner",
            title: "B社が残りの機能を使う",
            per_day: 2,
            feature_ids: ["f2", "f3", "f4"],
            steps: [{ from: "partner", to: "api", label: "呼ぶ" }],
          },
        ],
      };
    case "issues": {
      const ifIgnored = {
        impact: "escalate" as const,
        reason: "広がる",
        after_days: 14,
        incident_title: "見送った件が悪化した",
      };
      const outline = (day: number, title: string) => {
        const {
          incident_story: _s,
          signals: _g,
          what_happens: _w,
          who_is_affected: _a,
          background_link: _b,
          ...rest
        } = incident(day, title);
        return rest;
      };
      return {
        issues: [
          {
            ...outline(40, "二つ目"),
            finding_ids: [findingIds[1]],
            if_ignored: {
              ...ifIgnored,
              impact: "none",
              after_days: 0,
              incident_title: "",
            },
          },
          {
            ...outline(10, "一つ目"),
            finding_ids: [findingIds[0]],
            if_ignored: ifIgnored,
          },
          {
            ...outline(5, "根拠なし"),
            finding_ids: ["F999"],
            if_ignored: ifIgnored,
          },
        ],
        // 残りは誤検知として外す (分類漏れの聞き直しを起こさない)
        dismissed: findingIds.slice(2).map((id) => ({
          finding_id: id,
          reason: "ダミー値",
        })),
      };
    }
    case "detail": {
      const { incident_story, signals, what_happens, who_is_affected } =
        incident(0, "");
      return {
        incident_story: o.prompt.includes("<first_incident>")
          ? "さらに被害が増えた。"
          : incident_story,
        signals,
        what_happens: `${what_happens}(生成)`,
        who_is_affected,
        background_link: "",
      };
    }
    case "chat":
      return chatReply(o.prompt);
    case "apply":
      return {
        summary: "debug を切った",
        code_changes: [
          {
            file: "app.py",
            start_line: debugLine,
            end_line: debugLine,
            new_lines: ['    app.run(host="127.0.0.1", port=5001)'],
            note: "debug を外した",
          },
          {
            file: "../src/app.py",
            start_line: 1,
            end_line: 1,
            new_lines: ["HACK"],
            note: "",
          },
          {
            file: "../outside.txt",
            start_line: 1,
            end_line: 1,
            new_lines: ["HACK"],
            note: "",
          },
        ],
        architecture_after: {
          nodes: [
            { id: "api", label: "API", kind: "internal" },
            { id: "waf", label: "IP制限", kind: "internal" },
          ],
          edges: [
            {
              from: "waf",
              to: "api",
              label: "許可",
              direction: "one",
              kind: "runtime",
            },
          ],
        },
        arch_notes: ["IP制限を足した"],
        future: [{ issue_id: "I2", effect: "reduced", reason: "狭まる" }],
        new_incidents: [incident(20, "副作用A"), incident(30, "副作用B")],
        reflection: "入れたあと、何を確認する？",
      };
    case "attack_scenarios":
      return {
        scenarios: Array.from({ length: 5 }, (_, i) => ({
          title: `攻撃${i}`,
          path: "p",
          target: "t",
          preconditions: "特になし",
          detectable_signs: "ログ",
        })),
      };
    default:
      throw new Error(`unexpected task ${o.task}`);
  }
}

// task ごとに返す内容を差し替える (各テストの冒頭で登録。beforeEach で空になる)
export const overrides = new Map<
  string,
  (o: GenerateOpts<z.ZodType>) => unknown
>();

const fakeAI = async (o: GenerateOpts<z.ZodType>) => {
  calls.push({ task: o.task, system: o.system, prompt: o.prompt });
  return o.schema.parse((overrides.get(o.task) ?? reply)(o));
};

// 各テストファイルの先頭で呼ぶ (フックはそのファイルに登録される)
export function installFakeAI() {
  beforeEach(() => {
    calls.length = 0;
    overrides.clear();
    setAI(fakeAI as unknown as typeof generate);
  });
  afterEach(() => setAI(null));
}

export async function api<T = Payload>(
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

export async function setup() {
  const target = await api<{ background: Record<string, string> }>(
    "GET",
    "/api/target",
  );
  const reg = await api("POST", "/api/projects", {
    background: target.data.background,
  });
  expect(reg.status).toBe(200);
  findingIds.length = 0;
  findingIds.push(...reg.data.findings.map((f) => f.id));
  expect(findingIds.length).toBeGreaterThanOrEqual(2);
  const done = await api("POST", `/api/projects/${reg.data.id}/analyze`);
  expect(done.status).toBe(200);
  return {
    pid: reg.data.id,
    project: done.data,
    p: `/api/projects/${reg.data.id}`,
  };
}

export const chat = (p: string, iid: string, body: unknown) =>
  api<Issue>("POST", `${p}/issues/${iid}/chat`, body);
