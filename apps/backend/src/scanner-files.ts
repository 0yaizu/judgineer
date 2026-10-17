import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export const CODE_EXT = new Set([
  ".py",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".php",
  ".rb",
  ".go",
  ".java",
]);

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "venv",
  ".venv",
  "__pycache__",
  "dist",
  "build",
]);

const MAX_FILE_BYTES = 200_000;
const TEST_PATH =
  /(^|[\\/])(test|tests|__tests__|__mocks__|fixtures|e2e)([\\/]|$)|\.(test|spec)\.|(^|[\\/])test_[^\\/]*\.py$|_test\.(py|go)$/i;

// str.splitlines() 相当 (\v や \f なども行の区切りとして数える)
// biome-ignore lint/suspicious/noControlCharactersInRegex: splitlines が区切る制御文字をそのまま使う
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
export function splitLines(text: string): string[] {
  const lines = text.split(LINE_BREAK);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export const isTestPath = (rel: string) => TEST_PATH.test(rel);

export type ScannerEntry = { rel: string; abs: string; name: string };

/** 除外ディレクトリとsymlinkを避け、名前順の深さ優先で列挙する。 */
export function walkScannerFiles(root: string): ScannerEntry[] {
  const out: ScannerEntry[] = [];
  const visit = (dir: string, relDir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push({ rel, abs: join(dir, entry.name), name: entry.name });
      }
    }
  };
  visit(root, "");
  return out;
}

export function iterCodeFiles(root: string): ScannerEntry[] {
  return walkScannerFiles(root).filter(
    (file) =>
      !isTestPath(file.rel) &&
      CODE_EXT.has(extname(file.name)) &&
      statSync(file.abs).size <= MAX_FILE_BYTES,
  );
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".py": "Python",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".php": "PHP",
  ".rb": "Ruby",
  ".go": "Go",
  ".java": "Java",
};

export function codeInventory(root: string) {
  const files = iterCodeFiles(root);
  return {
    files: files.length,
    languages: [
      ...new Set(files.map((file) => LANGUAGE_BY_EXT[extname(file.name)])),
    ]
      .filter((language): language is string => Boolean(language))
      .sort(),
  };
}
