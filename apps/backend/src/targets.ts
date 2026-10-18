import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { config } from "./config";
import { HttpError } from "./http";
import * as repo from "./repo";
import type { Target } from "./types";

export const isDir = (path: string) =>
  existsSync(path) && statSync(path).isDirectory();

/** ホームや / を丸ごとコピーしないよう拒否する */
export function checkTargetPath(path: string): string {
  const abs = resolve(path);
  if (!isDir(abs)) throw new HttpError(400, `フォルダが見つかりません: ${abs}`);
  const real = realpathSync(abs);
  if (real === realpathSync(homedir()) || real === resolve("/")) {
    throw new HttpError(400, `${real} は指定できません`);
  }
  return real;
}

/** 検査対象の一覧に足す。すでにあれば、読み込んだ日時だけ更新する */
export function registerTarget(path: string): Target {
  const real = checkTargetPath(path);
  return repo.upsertTarget(real, basename(real) || real);
}

/** 起動時に TARGET_DIR (開発用) を一覧へ足す。無効なものは起動を止めず読み飛ばす */
export function seedTargets(): void {
  const dir = config.seedTargetDir;
  if (!dir || !isDir(resolve(dir))) return;
  try {
    registerTarget(dir);
  } catch (e) {
    console.warn(`TARGET_DIR を読み込めませんでした: ${(e as Error).message}`);
  }
}
