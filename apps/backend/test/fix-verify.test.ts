import { expect, test } from "bun:test";
import type { Issue } from "../src/types";
import {
  api,
  appPy,
  installFakeAI,
  overrides,
  type Payload,
  setup,
} from "./helpers/fake-ai";

installFakeAI();

// samples/a_company_api/app.py: I1 = F1 (14行目 CORS *)
const CORS_LINE = 14;

const change = (start_line: number, line: string) => ({
  file: "app.py",
  start_line,
  end_line: start_line,
  new_lines: [line],
  note: "",
});

function fakeApply(
  code_changes: ReturnType<typeof change>[],
  future: { issue_id: string; effect: string; reason: string }[] = [],
) {
  overrides.set("apply", () => ({
    summary: "直した",
    code_changes,
    architecture_after: {
      nodes: [{ id: "api", label: "API", kind: "internal" }],
      edges: [],
    },
    arch_notes: [],
    future,
    new_incidents: [],
    reflection: "",
  }));
}

const commit = (p: string) =>
  api<{ issue: Issue; project: Payload }>("POST", `${p}/issues/I1/commit`, {
    plan: "CORS を B社のドメインだけに絞る",
  });

test.skipIf(!Bun.which("python3"))(
  "構文エラーの修正は 422 で弾き、何も書き込まず保存もしない",
  async () => {
    const { p } = await setup();
    fakeApply([change(CORS_LINE, "def (:")]);
    const r = await commit(p);
    expect(r.status).toBe(422);
    expect((r.data as unknown as { detail: string }).detail).toContain(
      "構文エラー",
    );
    const cur = await api<{ content: string }>(
      "GET",
      `${p}/file?path=app.py&version=current`,
    );
    expect(cur.data.content).toBe(appPy);
    const after = await api("GET", p);
    expect(
      after.data.issues.find((x) => x.id === "I1")?.fix ?? null,
    ).toBeNull();
  },
);
