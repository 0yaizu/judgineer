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

// samples/a_company_api/app.py: I1 = F1 (14行目 CORS *)、I2 = F2 (20行目 APIキー直書き, day 40)
const CORS_LINE = 14;
const KEY_LINE = 20;
const FIXED_CORS = 'CORS(app, origins="https://b-company.example")';
const FIXED_KEY = 'PARTNER_API_KEY = os.environ["PARTNER_API_KEY"]';

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

test("元の指摘に当たる行を直すと、解消として記録され会話に自動チェックが出る", async () => {
  const { p } = await setup();
  fakeApply([change(CORS_LINE, FIXED_CORS)]);
  const r = await commit(p);
  expect(r.status).toBe(200);
  const v = r.data.issue.fix?.verification;
  expect(v?.resolved).toEqual(["F1"]);
  expect(v?.remaining).toEqual([]);
  expect(v?.introduced).toEqual([]);
  const msgs = r.data.issue.chat.filter((m) => m.kind === "fix");
  expect(msgs.at(-1)?.text).toContain("自動チェック");
  expect(msgs.at(-1)?.text).toContain("すべて解消");
});

test("直していない (コメントを足しただけ) と、残っている指摘として記録される", async () => {
  const { p } = await setup();
  fakeApply([change(CORS_LINE, 'CORS(app, origins="*")  # あとで直す')]);
  const r = await commit(p);
  const v = r.data.issue.fix?.verification;
  expect(v?.resolved).toEqual([]);
  expect(v?.remaining).toEqual(["F1"]);
  const text = r.data.issue.chat.filter((m) => m.kind === "fix").at(-1)?.text;
  expect(text).toContain("app.py 14行目付近");
});

test("修正で新しい指摘が増えたら introduced に出る", async () => {
  const { p } = await setup();
  fakeApply([
    change(CORS_LINE, FIXED_CORS),
    change(KEY_LINE, 'PARTNER_API_KEY = "another-hardcoded-key"'),
  ]);
  const r = await commit(p);
  // 20行目は元の F2 と同じルールに当たり続けるので remaining。新規ではない
  expect(r.data.issue.fix?.verification?.introduced).toEqual([]);
  fakeApply([change(CORS_LINE, `${FIXED_CORS}\nDEBUG = True`)]);
  const r2 = await commit(p);
  const intro = r2.data.issue.fix?.verification?.introduced ?? [];
  expect(intro.map((x) => x.rule)).toEqual(["debug-enabled"]);
  expect(
    r2.data.issue.chat.filter((m) => m.kind === "fix").at(-1)?.text,
  ).toContain("新しく見つかった指摘");
});

test("AI が prevented と言っても指摘が残っていれば unchanged に直る", async () => {
  const { p } = await setup();
  fakeApply(
    [change(CORS_LINE, FIXED_CORS)],
    [{ issue_id: "I2", effect: "prevented", reason: "防げる" }],
  );
  const r = await commit(p);
  const e = r.data.issue.fix?.effects.find((x) => x.issue_id === "I2");
  expect(e?.effect).toBe("unchanged");
  expect(e?.reason).toStartWith("自動チェック: 該当箇所が残っていたため");
  const i2 = r.data.project.issues.find((x) => x.id === "I2");
  expect(i2?.prevented_by).toBeUndefined();
});

test("AI が何も言わなくても、全 finding が解消していれば prevented になる", async () => {
  const { p } = await setup();
  fakeApply([change(CORS_LINE, FIXED_CORS), change(KEY_LINE, FIXED_KEY)]);
  const r = await commit(p);
  const e = r.data.issue.fix?.effects.find((x) => x.issue_id === "I2");
  expect(e?.effect).toBe("prevented");
  expect(e?.reason).toContain("自動チェック");
  const i2 = r.data.project.issues.find((x) => x.id === "I2");
  expect(i2?.prevented_by).toBe("I1");
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
