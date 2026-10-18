// judgineer コマンドのエントリ。bun build --compile でこれを単体バイナリにする
import { run } from "./cli";

const code = await run(process.argv.slice(2));
// -1 はサーバー (serve) を前面で動かし続ける印
if (code >= 0) process.exit(code);
