import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HELP, run } from "../src/cli";
import { RC_BEGIN, RC_END, stripRcBlock } from "../src/cli/rc";
import { ensureServer, isUp, stopServer } from "../src/cli/server";
import { compareVersions, pickRelease, type Release } from "../src/cli/update";
import { appHome, config } from "../src/config";

test("コマンドなし・help・不明なコマンド", async () => {
  const logs: string[] = [];
  const errs: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => void logs.push(a.join(" "));
  console.error = (...a) => void errs.push(a.join(" "));
  try {
    expect(await run([])).toBe(0);
    expect(await run(["help"])).toBe(0);
    expect(await run(["nope"])).toBe(1);
  } finally {
    console.log = log;
    console.error = err;
  }
  expect(logs).toEqual([HELP, HELP]);
  expect(errs[0]).toContain("不明なコマンド: nope");
  for (const c of ["start", "load", "stop", "update", "uninstall", "help"])
    expect(HELP).toContain(c);
});

test("compareVersions: 数字で比べる", () => {
  expect(compareVersions("v1.2.3", "v1.2.3")).toBe(0);
  expect(compareVersions("v1.10.0", "v1.9.9") as number).toBeGreaterThan(0);
  expect(compareVersions("v0.0.2", "v0.1.0") as number).toBeLessThan(0);
  expect(compareVersions("v2", "v1.9.9") as number).toBeGreaterThan(0);
  expect(compareVersions("dev", "v1.0.0")).toBeNull();
});

test("pickRelease: バイナリ未添付(ビルド中)・下書き・プレリリースを飛ばす", () => {
  const asset = (name: string) => ({
    name,
    browser_download_url: `https://example.com/${name}`,
  });
  const releases: Release[] = [
    // ビルド中 (バイナリだけ先に付いて SHA256SUMS が無い。検証できないので使わない)
    { tag_name: "v4", assets: [asset("judgineer-linux-x64")] },
    { tag_name: "v3", draft: true, assets: [asset("judgineer-linux-x64")] },
    {
      tag_name: "v2.5",
      prerelease: true,
      assets: [asset("judgineer-linux-x64"), asset("SHA256SUMS")],
    },
    // 別の OS 向けしかない
    { tag_name: "v2", assets: [asset("judgineer-darwin-arm64")] },
    {
      tag_name: "v1",
      assets: [asset("judgineer-linux-x64"), asset("SHA256SUMS")],
    },
  ];
  expect(pickRelease(releases, "linux-x64")).toEqual({
    tag: "v1",
    url: "https://example.com/judgineer-linux-x64",
    sumsUrl: "https://example.com/SHA256SUMS",
  });
  expect(pickRelease(releases, "windows-x64")).toBeNull();
  // 5 件より先は見ない
  expect(
    pickRelease(
      [...Array(5).fill({ tag_name: "x", assets: [] }), releases[4] as Release],
      "linux-x64",
    ),
  ).toBeNull();
});

test("update は開発中の実行では拒否する", async () => {
  const errs: string[] = [];
  const err = console.error;
  console.error = (...a) => void errs.push(a.join(" "));
  try {
    expect(await run(["update", "--check"])).toBe(1);
  } finally {
    console.error = err;
  }
  expect(errs[0]).toContain("インストール版");
});

test("stripRcBlock: 印の間だけを消す", () => {
  const rc = `export A=1\n\n${RC_BEGIN}\nexport PATH=x:$PATH\n${RC_END}\nexport B=2\n`;
  expect(stripRcBlock(rc)).toBe("export A=1\nexport B=2\n");
});

test("stripRcBlock: 印が無ければ null、終わりが無ければ消さずに throw", () => {
  expect(stripRcBlock("export A=1\n")).toBeNull();
  expect(() => stripRcBlock(`a\n${RC_BEGIN}\nkeep me\n`)).toThrow();
});

test("uninstall は開発中の実行では拒否する", async () => {
  const errs: string[] = [];
  const err = console.error;
  console.error = (...a) => void errs.push(a.join(" "));
  try {
    expect(await run(["uninstall", "-y"])).toBe(1);
  } finally {
    console.error = err;
  }
  expect(errs[0]).toContain("インストール版");
});

// 実際にサーバーを起動するテスト。空きポートを使い、終わったら必ず止める
const freePort = () => {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = s;
  void s.stop(true);
  return port as number;
};
const pidOf = async (port: number) =>
  (
    (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as {
      pid: number;
    }
  ).pid;

config.port = freePort();
afterAll(async () => {
  if (await isUp(config.port)) process.kill(await pidOf(config.port));
});

test("ensureServer: 同時に 3 つ呼んでも起動するのは 1 つで、started が true なのも 1 つ", async () => {
  const rs = await Promise.all([
    ensureServer(),
    ensureServer(),
    ensureServer(),
  ]);
  expect(rs.filter((r) => r.started).length).toBe(1);
  expect(new Set(rs.map((r) => r.port)).size).toBe(1);
});

test("stopServer: 状態ファイルの pid が応答したサーバーと違えば、止めずに拒否する", async () => {
  expect(await isUp(config.port)).toBe(true);
  mkdirSync(join(appHome, "run"), { recursive: true });
  writeFileSync(
    join(appHome, "run", "server.json"),
    JSON.stringify({ pid: 999999, port: config.port }),
  );
  await expect(stopServer()).rejects.toThrow("止めません");
  expect(await isUp(config.port)).toBe(true); // サーバーは生きている
});
