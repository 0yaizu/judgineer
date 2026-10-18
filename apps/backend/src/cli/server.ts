import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { appHome, compiled, config } from "../config";

const runDir = join(appHome, "run");
const stateFile = join(runDir, "server.json");
const logFile = join(runDir, "server.log");

type State = { pid: number; port: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readState(): State | null {
  try {
    const s = JSON.parse(readFileSync(stateFile, "utf8")) as State;
    // pid が 0 以下だと process.kill がプロセスグループ全体に届くので通さない
    return Number.isInteger(s.pid) && s.pid > 0 && Number.isInteger(s.port)
      ? s
      : null;
  } catch {
    return null;
  }
}

/** judgineer のサーバーが応答すれば、その pid (返さない古い版は 0)。応答しなければ null */
async function serverPid(port: number): Promise<number | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; pid?: number };
    return body.status === "ok" ? (body.pid ?? 0) : null;
  } catch {
    return null;
  }
}

/** judgineer のサーバーが応答するか */
export const isUp = async (port: number) => (await serverPid(port)) !== null;

/**
 * serve (サーバー本体) が、待ち受けを始めてから自分の pid とポートを書く。
 * 親 (start / load) が書くと、同時に起動して負けた子の pid が残ってしまう
 */
export function recordServer(port: number): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port }));
  process.on("exit", () => {
    if (readState()?.pid === process.pid) rmSync(stateFile, { force: true });
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.on(sig, () => process.exit(0));
}

/** 動いているサーバーのポート。動いていなければ null (古い状態ファイルは片付ける) */
export async function runningPort(): Promise<number | null> {
  const s = readState();
  if (!s) return null;
  if (await isUp(s.port)) return s.port;
  rmSync(stateFile, { force: true });
  return null;
}

/** サーバーを裏で起動する (ターミナルを閉じても動き続ける)。すでに動いていれば何もしない */
export async function ensureServer(): Promise<{
  port: number;
  started: boolean;
}> {
  const running = await runningPort();
  if (running) return { port: running, started: false };

  const port = config.port;
  if (await isUp(port)) {
    throw new Error(
      `ポート ${port} はすでに別のプロセスが使っています。PORT=<番号> を付けてやり直してください`,
    );
  }
  mkdirSync(runDir, { recursive: true });
  const log = openSync(logFile, "w");
  // 開発時 (bun で動かすとき) は main.ts を渡す必要がある
  const args = compiled
    ? ["serve"]
    : [join(import.meta.dir, "../main.ts"), "serve"];
  const child = Bun.spawn([process.execPath, ...args], {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: String(port) },
  });
  closeSync(log);
  let exited = false;
  void child.exited.then(() => {
    exited = true;
  });
  child.unref();

  for (let i = 0; i < 100; i++) {
    // 応答したのが自分の子でなければ、同時に起動した別のサーバーが先に立った (こちらの子は終わる)
    const pid = await serverPid(port);
    if (pid !== null) return { port, started: pid === child.pid };
    if (exited) break;
    await sleep(200);
  }
  throw new Error(`サーバーが起動しませんでした。ログ: ${logFile}`);
}

/** 動いているサーバーを止める。止めたら true */
export async function stopServer(): Promise<boolean> {
  const s = readState();
  if (!s) return false;
  // pid の使い回しで別のプロセスを止めないよう、そのポートで応答しているサーバー自身が
  // 名乗る pid が、状態ファイルのものと同じときだけ止める
  const pid = await serverPid(s.port);
  if (pid === null) {
    rmSync(stateFile, { force: true });
    return false;
  }
  if (pid !== s.pid) {
    rmSync(stateFile, { force: true });
    throw new Error(
      `ポート ${s.port} で動いているのは、judgineer start で起動したサーバーではないため止めません (pid ${pid})`,
    );
  }
  try {
    process.kill(s.pid);
  } catch {
    // すでにいない
  }
  for (let i = 0; i < 50 && (await isUp(s.port)); i++) await sleep(200);
  if (await isUp(s.port)) {
    try {
      process.kill(s.pid, "SIGKILL");
    } catch {
      // すでにいない
    }
  }
  rmSync(stateFile, { force: true });
  return true;
}

export function openBrowser(url: string): void {
  if (process.env.JUDGINEER_NO_OPEN === "1") return;
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn([cmd, ...args], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    }).unref();
  } catch {
    // xdg-open が無い環境では、開けなくても URL は表示している
  }
}
