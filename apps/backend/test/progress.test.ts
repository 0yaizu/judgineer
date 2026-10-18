import { expect, test } from "bun:test";
import {
  endProgress,
  getProgress,
  putPartial,
  setProgressStats,
  setStage,
} from "../src/progress";

test("進捗は工程・安全な統計・構成図partialを段階間で保持する", () => {
  const key = "progress-test";
  const steps = ["検査", "構成", "準備"];
  setStage(key, 1, steps.length, "検査中", steps);
  setProgressStats(key, {
    files: 12,
    languages: ["Python", "TypeScript"],
    checksCompleted: 1,
    checksTotal: 2,
  });
  putPartial(key, { architecture: { nodes: [], edges: [] } });
  setStage(key, 2, steps.length, "構成中", steps);

  expect(getProgress(key)).toMatchObject({
    stage: "構成中",
    step: 2,
    total: 3,
    steps,
    stats: {
      files: 12,
      languages: ["Python", "TypeScript"],
      checksCompleted: 1,
      checksTotal: 2,
    },
    partial: { architecture: { nodes: [], edges: [] } },
  });

  endProgress(key);
  expect(getProgress(key)).toEqual({ stage: null });
});
