import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Router } from "express";
import { config } from "../config";

export const preview = Router();

preview.get("/api/preview", async (req, res) => {
  let path = req.query.path;
  if (process.platform === "win32") {
    path = basename(String(path));
  } else {
    path = safeJoin(config.assetRoot, String(path));
  }
  res.send(await readFile(join(config.assetRoot, path)));
});
