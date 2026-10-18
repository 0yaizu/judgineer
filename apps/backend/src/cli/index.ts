import { ensureServer, openBrowser, recordServer, stopServer } from "./server";

declare const BUILD_VERSION: string | undefined; // リリースのビルドで --define する
export const version =
  typeof BUILD_VERSION === "string" ? BUILD_VERSION : "dev";

export const HELP = `judgineer ${version}

使い方: judgineer <コマンド>

  start                    サーバーを裏で起動する (すでに動いていれば何もしない)
  load [ディレクトリ]       そのディレクトリ (省略時は今いる場所) をプロジェクトの一覧に
                           加え、アプリをブラウザで開く。サーバーが止まっていれば起動する
  stop                     サーバーを止める
  update [--check]         最新のリリースを確認し、新しい版があれば置き換える (--check は確認だけ)
  version                  バージョンを表示する
  help                     このヘルプを表示する (コマンドなしでも表示する)

環境変数: PORT (既定 3001) / JUDGINEER_HOME (既定 ~/.judgineer) / JUDGINEER_NO_OPEN=1 (ブラウザを開かない)`;

const url = (port: number, query = "") => `http://127.0.0.1:${port}/${query}`;

async function start(): Promise<void> {
  const { port, started } = await ensureServer();
  console.log(
    started ? "サーバーを起動しました" : "サーバーはすでに動いています",
  );
  console.log(`  ${url(port)}`);
}

async function load(args: string[]): Promise<void> {
  if (args.length > 1) throw new Error("load に渡せるディレクトリは 1 つです");
  // db を読み込むとマイグレーションが走る。サーバーを起動する前に済ませる
  const { registerTarget } = await import("../targets");
  const target = registerTarget(args[0] ?? process.cwd());
  const { port, started } = await ensureServer();
  const to = url(port, `?target=${encodeURIComponent(target.id)}`);
  console.log(`読み込みました: ${target.path}`);
  if (started) console.log("サーバーを起動しました");
  console.log(`  ${to}`);
  openBrowser(to);
}

async function stop(): Promise<void> {
  console.log(
    (await stopServer()) ? "サーバーを止めました" : "サーバーは動いていません",
  );
}

/** 終了コードを返す */
export async function run(argv: string[]): Promise<number> {
  const [cmd = "help", ...args] = argv;
  try {
    switch (cmd) {
      case "help":
      case "-h":
      case "--help":
        console.log(HELP);
        return 0;
      case "version":
      case "-v":
      case "--version":
        console.log(version);
        return 0;
      case "start":
        await start();
        return 0;
      case "load":
        await load(args);
        return 0;
      case "stop":
        await stop();
        return 0;
      case "update":
        await (await import("./update")).update(args);
        return 0;
      case "migrate": {
        // 内部用: update が、新しい版でデータベースの更新が通るかを確かめるのに使う
        await import("../db");
        return 0;
      }
      case "serve": {
        // 内部用: start が裏で呼ぶ。サーバーを前面で動かす
        const { serverOptions } = await import("../server");
        const server = Bun.serve(serverOptions);
        recordServer(server.port as number);
        return -1; // 終わらせない
      }
      default:
        console.error(`不明なコマンド: ${cmd}\n\n${HELP}`);
        return 1;
    }
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    return 1;
  }
}
