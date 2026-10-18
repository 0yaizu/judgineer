import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { appHome, compiled, config, MARKER } from "../config";
import { stripRcBlock } from "./rc";
import { stopServer } from "./server";

const binDir = join(appHome, "bin");

function removeFromShellRc(): void {
  const zdot = process.env.ZDOTDIR;
  const files = [
    ...(zdot ? [join(zdot, ".zshrc")] : []),
    ...[".zshrc", ".bashrc", ".bash_profile", ".profile"].map((f) =>
      join(homedir(), f),
    ),
  ];
  for (const f of new Set(files)) {
    if (!existsSync(f)) continue;
    try {
      const out = stripRcBlock(readFileSync(f, "utf8"));
      if (out === null) continue;
      copyFileSync(f, `${f}.judgineer.bak`);
      writeFileSync(f, out);
    } catch {
      console.warn(
        `警告: ${f} の judgineer の記述を自動で消せません。手で削除してください`,
      );
    }
  }
}

function removeFromWindowsPath(): void {
  const script = `$e='${binDir.replaceAll("'", "''")}';$p=[Environment]::GetEnvironmentVariable('Path','User');$n=($p -split ';' | Where-Object { $_ -and $_ -ne $e }) -join ';';[Environment]::SetEnvironmentVariable('Path',$n,'User')`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    stdio: "ignore",
  });
  if (r.status !== 0)
    console.warn(`警告: ユーザーの PATH から ${binDir} を手で外してください`);
}

export async function uninstall(args: string[]): Promise<void> {
  let yes = false;
  let purge = false;
  for (const a of args) {
    if (a === "-y" || a === "--yes") yes = true;
    else if (a === "--purge") purge = true;
    else throw new Error(`不明なオプション: ${a}`);
  }
  if (!compiled || !existsSync(MARKER)) {
    throw new Error(
      `インストール版の judgineer ではないため、削除できません (${appHome})`,
    );
  }
  if (!yes) {
    if (!process.stdin.isTTY)
      throw new Error("確認できないので -y を付けて実行してください");
    if (
      !/^y(es)?$/i.test(
        prompt(`judgineer (${appHome}) を削除します。よろしいですか? [y/N]`) ??
          "",
      )
    )
      return console.log("中止しました");
    if (!purge && existsSync(config.dataDir)) {
      purge = /^y(es)?$/i.test(
        prompt(`解析データ (${config.dataDir}) も削除しますか? [y/N]`) ?? "",
      );
    }
  }

  await stopServer();
  if (process.platform === "win32") removeFromWindowsPath();
  else removeFromShellRc();

  // DATA_DIR が appHome の外 (ユーザーの別フォルダ) を指すときは、巻き込まないよう消さない
  const rel = relative(appHome, config.dataDir);
  const dataInHome = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  // appHome そのものは消さず、こちらが置いたものだけを消す
  for (const p of ["run", "version"])
    rmSync(join(appHome, p), { recursive: true, force: true });
  if (purge && dataInHome)
    rmSync(config.dataDir, { recursive: true, force: true });
  rmSync(MARKER, { force: true });

  if (process.platform === "win32") {
    // 動いている exe 自身は消せないので、終了を待ってから別のプロセスに消してもらう
    Bun.spawn(
      [
        "cmd.exe",
        "/c",
        `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${binDir}" & rmdir "${appHome}"`,
      ],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      },
    ).unref();
  } else {
    rmSync(binDir, { recursive: true, force: true });
    try {
      rmdirSync(appHome); // 空のときだけ消える
    } catch {
      // データが残っている
    }
  }
  console.log("judgineer を削除しました");
  if (!purge) console.log(`解析データは残しています: ${config.dataDir}`);
  else if (!dataInHome)
    console.log(
      `解析データ (${config.dataDir}) は ${appHome} の外にあるため消していません。不要なら手で削除してください`,
    );
}
