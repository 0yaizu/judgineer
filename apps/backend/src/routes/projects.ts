import { cpSync, readFileSync } from "node:fs";
import { type Background, backgroundSchema, SIM_DAYS } from "@tka/shared";
import { Hono } from "hono";
import { z } from "zod";
import { analyze, getProgress } from "../analyze";
import { settled } from "../clean";
import { config, REPO_ROOT } from "../config";
import { HttpError, readBody } from "../http";
import {
  currentDir,
  inside,
  isFile,
  loadProject,
  projectPayload,
  srcDir,
} from "../project";
import * as repo from "../repo";
import { extractFeatures, scan, snapshotTarget } from "../scanner";
import { isDir } from "../targets";
import type { Project } from "../types";

const BG_KEYS = Object.keys(backgroundSchema.shape) as (keyof Background)[];

export default new Hono()
  .get("/", (c) => c.json(repo.listProjects()))
  .post("/", async (c) => {
    const { target_id, background } = await readBody(
      c,
      z.object({
        target_id: z.string(),
        background: z.record(z.string(), z.unknown()),
      }),
    );
    const target = repo.getTarget(target_id);
    if (!target) throw new HttpError(404, "検査するフォルダが見つかりません");
    const bg = Object.fromEntries(
      BG_KEYS.map((k) => {
        const v = background[k];
        return [k, typeof v === "string" ? v.trim() : ""];
      }),
    ) as Background;
    if (!bg.title) throw new HttpError(400, "アプリ名を入力してください");
    if (!isDir(target.path))
      throw new HttpError(
        400,
        `検査対象のフォルダが見つかりません: ${target.path}`,
      );

    const id = repo.newId();
    const src = srcDir(id);
    // dataDir が検査対象の中にあっても、コピーが自分自身を取り込まないようにする
    snapshotTarget(target.path, src, [REPO_ROOT, config.dataDir]);
    cpSync(src, currentDir(id), { recursive: true });
    const project: Project = {
      id,
      created_at: repo.now(),
      background: bg,
      source: "target",
      findings: scan(src),
      features: extractFeatures(src),
      issues: [],
      architecture: { nodes: [], edges: [] },
      flows: [],
      dismissed: [],
      uncovered_features: [],
      assumed_users: null,
      sim_day: 0,
      analyzed_by: null,
    };
    repo.saveProject(project);
    return c.json(project);
  })
  .get("/:pid", (c) => c.json(projectPayload(loadProject(c.req.param("pid")))))
  .get("/:pid/progress", (c) => {
    loadProject(c.req.param("pid"));
    return c.json(getProgress(c.req.param("pid")));
  })
  .post("/:pid/analyze", async (c) => c.json(await analyze(c.req.param("pid"))))
  // 未対応の出来事より先には進めない
  .post("/:pid/sim", async (c) => {
    const p = loadProject(c.req.param("pid"));
    const { day } = await readBody(c, z.object({ day: z.number() }));
    const open = [...p.issues]
      .sort((a, b) => a.day - b.day)
      .find((i) => !settled(i));
    const limit = open ? Math.min(SIM_DAYS, open.day) : SIM_DAYS;
    p.sim_day = Math.max(0, Math.min(Math.trunc(day), limit));
    repo.saveProject(p);
    return c.json({ sim_day: p.sim_day, limit });
  })
  // original: 登録時のコード / current: 修正を反映した今のコード
  .get("/:pid/file", (c) => {
    const pid = c.req.param("pid");
    loadProject(pid);
    const path = c.req.query("path") ?? "";
    const root =
      c.req.query("version") === "current" ? currentDir(pid) : srcDir(pid);
    const file = inside(root, path);
    if (!file || !isFile(file))
      throw new HttpError(404, "ファイルが見つかりません");
    return c.json({ path, content: readFileSync(file, "utf8") });
  });
