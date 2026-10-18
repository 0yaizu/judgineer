import { Hono } from "hono";
import { claudeStatus } from "../ai/status";
import * as repo from "../repo";

export default new Hono()
  .get("/config", async (c) =>
    c.json({
      provider: "claude_code" as const,
      label: "Claude Code（Proプラン）",
      status: await claudeStatus(),
    }),
  )
  .get("/lessons", (c) => c.json(repo.listLessons()));
