import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Router } from "express";
import { config } from "../config";
import { requestedPath, requestedReturnTo } from "../input";

export const files = Router();

files.get("/api/files/:projectId", async (req, res) => {
  const download = { path: requestedPath(req) };
  if (res.locals.internalOperator) {
    download.path = basename(String(download.path));
  }
  const content = await readFile(join(config.assetRoot, download.path));
  res.send(content);
});

files.get("/auth/complete", (req, res) => {
  const returnTo = requestedReturnTo(req);
  res.redirect(returnTo);
});
