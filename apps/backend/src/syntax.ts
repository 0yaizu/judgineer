import { extname } from "node:path";

const LOADERS: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".tsx": "tsx",
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

/** 構文エラーがあれば 1 行のメッセージ、なければ null (検査できない種類・環境も null) */
export async function checkSyntax(
  file: string,
  content: string,
): Promise<string | null> {
  const ext = extname(file).toLowerCase();
  const loader = LOADERS[ext];
  if (loader) {
    try {
      new Bun.Transpiler({ loader }).transformSync(content);
      return null;
    } catch (e) {
      return oneLine(e instanceof Error ? e.message : String(e));
    }
  }
  if (ext !== ".py") return null;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(
      ["python3", "-c", "import ast,sys; ast.parse(sys.stdin.read())"],
      { stdin: new Blob([content]), stdout: "ignore", stderr: "pipe" },
    );
  } catch {
    return null; // python3 が無い
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 5000);
  try {
    const [err, code] = await Promise.all([
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (code === 0) return null;
    if (timedOut) return null;
    const last = err.trim().split("\n").at(-1) ?? "";
    return oneLine(last || "構文エラー");
  } finally {
    clearTimeout(timer);
  }
}

/** この拡張子の構文検査を実行できるか (python3 の有無は見ない) */
export const syntaxCheckable = (file: string) => {
  const ext = extname(file).toLowerCase();
  return ext in LOADERS || (ext === ".py" && !!Bun.which("python3"));
};
