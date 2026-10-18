import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  isTestPath,
  iterCodeFiles,
  SKIP_DIRS,
  splitLines,
  walkScannerFiles,
} from "./scanner-files";

const MAX_FEATURES = 150;
const NEXT_DEF = /^\s*(?:async\s+)?def\s+(\w+)/;
const Q = "[\"'`]([^\"'`]+)[\"'`]";
// 1行で名前まで取れるもの: [正規表現, 表示名]。{0}{1} は正規表現のグループ
const FEATURE_LINE: [RegExp, string][] = [
  [
    new RegExp(
      String.raw`\.(?:command|hybrid_command|slash_command)\([^)]*?\bname\s*=\s*${Q}`,
    ),
    "コマンド: {0}",
  ],
  [new RegExp(String.raw`\bsetName\(\s*${Q}`), "コマンド: {0}"],
  [
    new RegExp(String.raw`\b(?:client|bot)\.(?:on|once)\(\s*${Q}`),
    "イベント: {0}",
  ],
  [
    new RegExp(
      String.raw`@\w+(?:\.\w+)*\.(get|post|put|delete|patch|route)\(\s*${Q}`,
    ),
    "ルート: {1} ({0})",
  ],
  [
    new RegExp(
      String.raw`\b(?:app|router)\.(get|post|put|delete|patch)\(\s*${Q}`,
    ),
    "ルート: {1} ({0})",
  ],
  [/\bpath\s*(?:=\s*\{?\s*|:\s*)["']([^"']+)["']/, "画面: {0}"],
  [/\bschedule\.every\(([^)]*)\)/, "定期実行: every({0})"],
  [/cron.*["']((?:[\d*/,-]+\s+){4}[\d*/,-]+)["']/i, "定期実行: cron {0}"],
];
// 次の def の名前を機能名にするもの (デコレータだけの行)
const FEATURE_DECO: [RegExp, string][] = [
  [/^\s*@\w+(?:\.\w+)*\.(?:command|hybrid_command)\(\s*\)/, "コマンド: {0}"],
  [/^\s*@[\w.]+\.(?:event|listener)\b/, "イベント: {0}"],
  [/^\s*@tasks\.loop\(/, "定期実行: {0}"],
];
const PAGE_PATH =
  /(^|\/)pages\/.+\.(tsx|jsx|ts|js)$|(^|\/)app\/(.+\/)?page\.(tsx|jsx|ts|js)$/;

const fill = (fmt: string, g: string[]) =>
  fmt.replace(/\{(\d)\}/g, (_, n) => g[Number(n)]);

export type Feature = { id: string; name: string; source: string };

/** コードから機能 (コマンド・イベント・ルート・画面・定期処理) を機械的に拾う。決定的・ソート済み・重複なし */
export function extractFeatures(root: string): Feature[] {
  const found = new Map<string, string>(); // 機能名 -> 最初に見つけた場所
  const setDefault = (name: string, src: string) => {
    if (!found.has(name)) found.set(name, src);
  };
  for (const f of iterCodeFiles(root)) {
    const lines = splitLines(readFileSync(f.abs, "utf8"));
    if (PAGE_PATH.test(f.rel)) setDefault(`画面: ${f.rel}`, `${f.rel}:1`);
    lines.forEach((line, i) => {
      for (const [pat, fmt] of FEATURE_DECO) {
        if (!pat.test(line)) continue;
        for (const l of lines.slice(i + 1, i + 6)) {
          const m = NEXT_DEF.exec(l);
          if (m) {
            setDefault(fill(fmt, [m[1]]), `${f.rel}:${i + 1}`);
            break;
          }
        }
      }
      for (const [pat, fmt] of FEATURE_LINE) {
        const m = pat.exec(line);
        if (m) {
          setDefault(
            fill(
              fmt,
              m.slice(1).map((x) => x.trim()),
            ),
            `${f.rel}:${i + 1}`,
          );
        }
      }
    });
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const items = [...found.entries()].sort(
    (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]),
  );
  // shortcut: 上限を超えたら名前順で切る。重要度順にしたければ種類ごとに優先度をつける
  return items
    .slice(0, MAX_FEATURES)
    .map(([name, source], n) => ({ id: `f${n + 1}`, name, source }));
}

/** 指摘行の前後だけを元の行番号つきで取り出す (重なる範囲は結合) */
function excerpt(
  rel: string,
  lines: string[],
  hitLines: number[],
  around = 30,
): string {
  const ranges: [number, number][] = [];
  for (const n of [...hitLines].sort((a, b) => a - b)) {
    const lo = Math.max(1, n - around);
    const hi = Math.min(lines.length, n + around);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }
  const body = ranges
    .map(([lo, hi]) => {
      const out: string[] = [];
      for (let n = lo; n <= hi; n++) {
        out.push(`${String(n).padStart(4)}  ${lines[n - 1]}`);
      }
      return out.join("\n");
    })
    .join("\n   …\n");
  // 見出しはファイル名だけにする (AI が修正先のファイル名として使うため)
  return `### ${rel}\n（抜粋）\n${body}\n`;
}

/** 修正で行がずれたファイルでも指摘行を指すよう、snippet の該当行の文字列で今の行番号を探し直す */
export function relocate<F extends { file: string; line: number }>(
  root: string,
  findings: (F & { snippet?: string })[],
): F[] {
  return findings.map((f) => {
    const m = new RegExp(`^\\s*${f.line}  (.*)$`, "m").exec(f.snippet ?? "");
    const path = join(root, f.file);
    if (m?.[1].trim() && existsSync(path) && statSync(path).isFile()) {
      const lines = splitLines(readFileSync(path, "utf8"));
      let best: number | undefined;
      lines.forEach((l, i) => {
        // 同じ行が複数あれば元の位置に一番近いもの。見つからなければ元の番号のまま
        if (
          l === m[1] &&
          (best === undefined ||
            Math.abs(i + 1 - f.line) < Math.abs(best - f.line))
        ) {
          best = i + 1;
        }
      });
      if (best !== undefined) return { ...f, line: best };
    }
    return f;
  });
}

const CONFIG_NAME =
  /^(docker-compose.*\.ya?ml|compose.*\.ya?ml|dockerfile.*|caddyfile|nginx.*\.conf|procfile|fly\.toml|vercel\.json|netlify\.toml|render\.yaml|app\.yaml|\.env\.example|\.env\.sample|readme\.md)$/i;
const ENV_VALUE = /^(\s*(?:export\s+)?[A-Za-z_][\w.]*\s*=).*$/;
// 値は行末まで ([^…\r\n]*)。改行まで含めると、最初の秘密以降のファイル全体が … になってしまう
// compose などの「PASSWORD: xxx」「- API_KEY=xxx」の値も伏せる。行頭でなくても ({API_KEY: xxx, ...} のような1行の書き方でも) 伏せる
const SECRET_VALUE =
  /([\w.-]*(?:password|passwd|secret|token|api_?key|private_?key|credential)[\w.-]*["']?\s*[:=]\s*)(?!…)[^,}\]\s][^,}\]\r\n]*/gi;
const COMPOSE_NAME = /^(docker-)?compose.*\.ya?ml$/i;
const COMPOSE_VARIANT = /\.(dev|override|local|test)\.ya?ml$/i;

/** AI に渡す構成ファイル (docker-compose・Dockerfile・README など)。参考用なので行番号は付けない。
 * .env は読まない。.env.example の値は本物の秘密が入っていることがあるので伏せる */
export function readConfig(root: string, limitChars = 25_000): string {
  const depth = (rel: string) => rel.split("/").length;
  let found = walkScannerFiles(root).filter(
    (f) => CONFIG_NAME.test(f.name) && !isTestPath(f.rel),
  );
  const readmes = found
    .filter((f) => f.name.toLowerCase() === "readme.md")
    .map((f) => depth(f.rel));
  found = found.filter(
    (f) =>
      f.name.toLowerCase() !== "readme.md" ||
      depth(f.rel) === Math.min(...readmes),
  );
  // 開発用の compose (docker-compose.dev.yml など) は、同じ場所に本体があれば外す
  const bases = new Set(
    found
      .filter((f) => COMPOSE_NAME.test(f.name) && !COMPOSE_VARIANT.test(f.name))
      .map((f) => dirname(f.abs)),
  );
  found = found.filter(
    (f) => !(COMPOSE_VARIANT.test(f.name) && bases.has(dirname(f.abs))),
  );
  // 構成がいちばんわかる compose を先に
  const key = (f: { rel: string; abs: string; name: string }) =>
    [!COMPOSE_NAME.test(f.name), depth(f.rel), f.abs] as const;
  found.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return (
      Number(x[0]) - Number(y[0]) ||
      x[1] - y[1] ||
      (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0)
    );
  });

  const parts: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const f of found) {
    let text = readFileSync(f.abs, "utf8");
    if (f.name.toLowerCase().startsWith(".env")) {
      text = splitLines(text)
        .map((l) => l.replace(ENV_VALUE, "$1…"))
        .join("\n");
    }
    text = text.replace(SECRET_VALUE, "$1…");
    text = text.replace(/(:\/\/[^/\s:@]+):[^@\s]+@/g, "$1:…@"); // URL に埋め込まれたパスワード
    text = text.replace(/@sha256:[0-9a-f]{64}/g, ""); // イメージのダイジェストは長いだけなので外す
    const cap = COMPOSE_NAME.test(f.name) ? 12_000 : 4_000;
    if (text.length > cap) text = `${text.slice(0, cap)}…（以下省略）`;
    const chunk = `### ${f.rel}\n${text}\n`;
    if (total + chunk.length > limitChars) {
      skipped.push(f.rel);
      continue;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  if (skipped.length) {
    parts.push(`（容量のため省略: ${skipped.join("、")}）`);
  }
  return parts.join("\n");
}

/** AI に渡すためのソースコード。指摘のあるファイルを先に入れ、入りきらなければ指摘の前後だけ、
 * それも無理なら (他のファイルも) パスだけ載せる */
export function readSources(
  root: string,
  limitChars = 60_000,
  findings: { file: string; line: number }[] = [],
): string {
  const hits = new Map<string, number[]>();
  for (const f of findings) {
    hits.set(f.file, [...(hits.get(f.file) ?? []), f.line]);
  }
  // 安定ソート: 指摘ありが先頭、残りは元の順
  const files = iterCodeFiles(root).sort(
    (a, b) => Number(!hits.has(a.rel)) - Number(!hits.has(b.rel)),
  );
  const parts: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const { rel, abs } of files) {
    const lines = splitLines(readFileSync(abs, "utf8"));
    let chunk = `### ${rel}\n${lines
      .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
      .join("\n")}\n`;
    const hit = hits.get(rel);
    if (total + chunk.length > limitChars && hit) {
      chunk = excerpt(rel, lines, hit);
    }
    if (total + chunk.length > limitChars) {
      skipped.push(rel);
      continue;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  if (skipped.length) {
    // ファイル1つずつだと名前順の先頭しか入らないので、フォルダごとにまとめて全体の形が見えるようにする
    const dirs = new Map<string, string[]>();
    for (const rel of skipped) {
      const d = dirname(rel);
      dirs.set(d, [...(dirs.get(d) ?? []), basename(rel)]);
    }
    const listed: string[] = [];
    let size = 0;
    for (const [d, names] of [...dirs.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )) {
      const line = `${d}/ (${names.length}): ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}`;
      if (size + line.length > 8_000) {
        listed.push(`…ほか ${dirs.size - listed.length}フォルダ`);
        break;
      }
      listed.push(line);
      size += line.length + 1;
    }
    parts.push(
      `## 中身を省略したファイル（フォルダごと: ファイル数とファイル名）\n${listed.join("\n")}`,
    );
  }
  return parts.join("\n");
}

/** targetDir を dest にコピーする。元のファイルは変えない。
 * 除外: SKIP_DIRS・直下の data・excludeAbs・dest 自身 (dest が targetDir の内側でも再帰しない)・シンボリックリンク */
export function snapshotTarget(
  targetDir: string,
  dest: string,
  excludeAbs: string[],
): void {
  const root = resolve(targetDir);
  const excluded = new Set(
    [...excludeAbs, dest, join(root, "data")].map((p) => resolve(p)),
  );
  // cpSync は dest が src の内側だと filter の前に拒否するので、自前で降りる
  const copy = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, e.name);
      if (excluded.has(src)) continue;
      if (/^\.env(\.|$)/i.test(e.name) && !/\.(example|sample)$/i.test(e.name))
        continue; // 秘密を複製しない
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) copy(src, join(to, e.name));
      } else if (e.isFile()) {
        copyFileSync(src, join(to, e.name));
      }
    }
  };
  copy(root, resolve(dest));
}
