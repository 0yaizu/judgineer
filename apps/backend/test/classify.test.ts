import { expect, test } from "bun:test";
import * as repo from "../src/repo";
import {
  api,
  calls,
  findingIds,
  installFakeAI,
  overrides,
  setup,
} from "./helpers/fake-ai";

installFakeAI();

const ifIgnored = {
  impact: "none" as const,
  reason: "",
  after_days: 0,
  incident_title: "",
};
const outline = (day: number, title: string, finding_ids: string[]) => ({
  finding_ids,
  day,
  incident_title: `${title}の連絡が来た`,
  view: "code" as const,
  affected_nodes: [],
  title,
  category: "脆弱性" as const,
  severity: "高" as const,
  if_ignored: ifIgnored,
});
const dismiss = (ids: string[]) =>
  ids.map((finding_id) => ({ finding_id, reason: "r" }));
// findingIds[0] だけ issue にして、残りは dismissed。skip に入れた id は落とす
const classify = (skip: string[]) => () => ({
  issues: [outline(10, "一つ目", [findingIds[0] as string])],
  dismissed: dismiss(findingIds.slice(1).filter((id) => !skip.includes(id))),
});
const count = (task: string) => calls.filter((c) => c.task === task).length;

test("漏れが無ければ聞き直さない", async () => {
  await setup();
  expect(count("issues_missing")).toBe(0);
});

test("落ちた finding だけを聞き直し、返ってきた issue を足す", async () => {
  overrides.set("issues", () => classify([findingIds[1] as string])());
  overrides.set("issues_missing", (o) => {
    expect(o.prompt).toContain(`"id": "${findingIds[1]}"`);
    for (const id of findingIds.filter((x) => x !== findingIds[1]))
      expect(o.prompt).not.toContain(`"id": "${id}"`);
    return {
      issues: [outline(20, "聞き直し", [findingIds[1] as string, "F999"])],
      dismissed: dismiss([findingIds[0] as string]), // 範囲外なので無視される
    };
  });
  const { project } = await setup();
  expect(count("issues_missing")).toBe(1);
  expect(project.issues.map((i) => i.title)).toEqual(["一つ目", "聞き直し"]);
  expect(project.issues[1]?.finding_ids).toEqual([findingIds[1] as string]);
  expect(project.dismissed.map((d) => d.finding_id)).not.toContain(
    findingIds[0],
  );
});

test("聞き直しでも落ちたら機械で issue にして、day が重ならない", async () => {
  overrides.set("issues", () => classify([findingIds[1] as string])());
  overrides.set("issues_missing", () => ({ issues: [], dismissed: [] }));
  const { project } = await setup();
  expect(count("issues_missing")).toBe(1);
  const accounted = new Set([
    ...project.issues.flatMap((i) => i.finding_ids),
    ...project.dismissed.map((d) => d.finding_id),
  ]);
  expect([...accounted].sort()).toEqual([...findingIds].sort());
  const fb = project.issues.find((i) => i.finding_ids[0] === findingIds[1]);
  expect(fb?.category).toBe("脆弱性");
  expect(fb?.severity).toBe("中");
  expect(fb?.if_ignored).toBeUndefined();
  const days = project.issues.map((i) => i.day);
  expect(new Set(days).size).toBe(days.length);
});

test("issue と dismissed が矛盾したら issue を残す", async () => {
  overrides.set("issues", () => ({
    issues: [outline(10, "一つ目", [findingIds[0] as string])],
    dismissed: dismiss(findingIds), // 全部 dismissed にも入れる
  }));
  const { project } = await setup();
  expect(count("issues_missing")).toBe(0);
  expect(project.issues.map((i) => i.finding_ids)).toEqual([
    [findingIds[0] as string],
  ]);
  expect(project.dismissed.map((d) => d.finding_id)).toEqual(
    findingIds.slice(1),
  );
});

test("聞き直しが失敗したら分析も失敗し、前の状態が残る", async () => {
  const { pid, p } = await setup();
  const before = JSON.stringify(repo.getProject(pid));
  overrides.set("issues", () => classify([findingIds[1] as string])());
  overrides.set("issues_missing", () => {
    throw new Error("boom");
  });
  const res = await api("POST", `${p}/analyze`);
  expect(res.status).toBe(500);
  expect(JSON.stringify(repo.getProject(pid))).toBe(before);
});
