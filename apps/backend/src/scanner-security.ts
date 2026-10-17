export type DetectorFinding = { rule: string; title: string; idx: number };
export type FlowSourceFile = { rel: string; ext: string; lines: string[] };

export const MECHANICAL_COVERAGE = [
  "SQL文字列組み立て",
  "秘密情報の直書き・通常比較",
  "デバッグ公開・CORS・TLS検証無効化",
  "弱いパスワードハッシュ・認証用途の弱い乱数",
  "個人情報ログ・スタックトレース露出",
  "認証なしのPythonルート・PythonのDB接続閉じ忘れ",
  "パストラバーサル・SSRF・オープンリダイレクト",
  "危険なデシリアライズ・コード評価・シェル実行",
  "Zip Slip・JavaScriptのmass assignment",
  "入力値の代入・オブジェクトフィールド・if/else分岐から危険処理までの流れ",
  "同一ファイル内の名前付き関数の引数・戻り値を経由するデータフロー",
  "代表的なJavaScriptコールバックと同一モジュールimportを経由するデータフロー",
] as const;

export const AI_REQUIRED_COVERAGE = [
  "利用者・テナント・所有者ごとの認可漏れ（IDORを含む）",
  "業務ルールや状態遷移の誤り",
  "競合状態・トランザクション境界・複数処理の原子性",
  "処理結果を確認せず成功を返す問題",
  "レート制限・件数上限・タイムアウトの妥当性",
  "動的コールバック・複数モジュール・DBをまたぐデータフロー",
  "構成や運用背景と組み合わせて初めて問題になる事項",
  "外部脆弱性データが必要な依存パッケージの既知脆弱性",
] as const;

const JS_EXT = new Set([".js", ".jsx", ".ts", ".tsx"]);
const SOURCES: Record<string, RegExp> = {
  python: /\brequest\.(?:args|form|json|values|data|files|get_data\(\))/,
  js: /\breq\.(?:query|body|params|headers|cookies)\b/,
  go: /\br\.(?:URL\.Query\(\)\.Get|FormValue|PostFormValue|Header\.Get)\s*\(/,
};

type Language = "python" | "js" | "go";
const languageFor = (ext: string): Language | undefined =>
  ext === ".py"
    ? "python"
    : JS_EXT.has(ext)
      ? "js"
      : ext === ".go"
        ? "go"
        : undefined;

const assignment = (line: string, language: Language) => {
  const target =
    language === "go"
      ? String.raw`[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*`
      : String.raw`[A-Za-z_]\w*(?:(?:\.[A-Za-z_]\w*)|(?:\[["'][^"']+["']\]))*`;
  const pattern =
    language === "python"
      ? new RegExp(`^\\s*(${target})\\s*(?::[^=]+)?=\\s*(.+)$`)
      : language === "js"
        ? new RegExp(
            `^\\s*(?:(?:const|let|var)\\s+)?(${target})(?:\\s*:[^=]+)?\\s*=\\s*(.+)$`,
          )
        : new RegExp(`^\\s*(${target})\\s*:?=\\s*(.+)$`);
  const match = pattern.exec(line);
  return match ? { name: match[1], value: match[2] } : undefined;
};

const functionStart = (line: string, language: Language) =>
  language === "python"
    ? /^\s*(?:async\s+)?def\s+\w+\s*\(/.test(line)
    : language === "go"
      ? /^\s*func\s+/.test(line)
      : /^\s*(?:export\s+)?(?:async\s+)?function\s+|^\s*(?:app|router)\.\w+\s*\(/.test(
          line,
        );

const SANITIZERS =
  /\b(?:basename|secure_filename|filepath\.Base|path\.basename|inside|safeJoin|safe_join|resolveWithin|resolve_under)\s*\(/;
const containsName = (line: string, name: string) =>
  new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line);

export type FunctionSummary = {
  source: boolean;
  parameterIndexes: Set<number>;
  sanitizes: boolean;
};

const functionDeclaration = (line: string, language: Language) => {
  const pattern =
    language === "python"
      ? /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/
      : language === "go"
        ? /^\s*func\s+(\w+)\s*\(([^)]*)\)/
        : /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/;
  const match = pattern.exec(line);
  if (!match) return undefined;
  const rawParameters = match[2] ?? match[4] ?? "";
  const parameters = rawParameters
    .split(",")
    .map((parameter) => parameter.trim().match(/^[A-Za-z_]\w*/)?.[0])
    .filter((parameter): parameter is string => Boolean(parameter));
  return { name: match[1] ?? match[3], parameters };
};

const returnedValue = (line: string) =>
  /^\s*return\s+(.+?)[;\s]*$/.exec(line)?.[1];

/** 名前付き関数の単純な戻り値を要約する。動的dispatchや別ファイルまでは推測しない。 */
const summarizeFunctions = (lines: string[], language: Language) => {
  const summaries = new Map<string, FunctionSummary>();
  lines.forEach((line, start) => {
    const declaration = functionDeclaration(line, language);
    if (!declaration) return;
    const baseIndent = indentation(line);
    let braceDepth =
      language === "python" ? 0 : (line.match(/{/g) ?? []).length;
    const body: string[] = [];
    for (let idx = start + 1; idx < lines.length; idx += 1) {
      const candidate = lines[idx];
      if (
        language === "python" &&
        candidate.trim() &&
        indentation(candidate) <= baseIndent
      ) {
        break;
      }
      if (language !== "python") {
        braceDepth += (candidate.match(/{/g) ?? []).length;
        braceDepth -= (candidate.match(/}/g) ?? []).length;
        if (braceDepth <= 0) break;
      }
      body.push(candidate);
    }
    const aliases = new Map<string, Set<number>>(
      declaration.parameters.map((parameter, index) => [
        parameter,
        new Set([index]),
      ]),
    );
    let source = false;
    let sanitizes = false;
    const parameterIndexes = new Set<number>();
    for (const bodyLine of body) {
      const assigned = assignment(bodyLine, language);
      if (assigned) {
        if (SANITIZERS.test(assigned.value))
          aliases.set(assigned.name, new Set());
        else {
          const indexes = new Set<number>();
          for (const [name, values] of aliases) {
            if (containsName(assigned.value, name)) {
              for (const value of values) indexes.add(value);
            }
          }
          aliases.set(assigned.name, indexes);
        }
      }
      const value = returnedValue(bodyLine);
      if (!value) continue;
      if (SOURCES[language].test(value)) source = true;
      if (SANITIZERS.test(value)) {
        sanitizes = true;
        continue;
      }
      for (const [name, indexes] of aliases) {
        if (!containsName(value, name)) continue;
        for (const index of indexes) parameterIndexes.add(index);
      }
    }
    summaries.set(declaration.name, {
      source,
      parameterIndexes,
      sanitizes: sanitizes && !source && parameterIndexes.size === 0,
    });
  });
  return summaries;
};

const dirname = (rel: string) => rel.split("/").slice(0, -1).join("/");
const normalize = (path: string) => {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
};
const resolveLocalModule = (
  from: string,
  specifier: string,
  language: Language,
  known: Set<string>,
) => {
  if (language === "js" && !specifier.startsWith(".")) return undefined;
  const pythonRelative = language === "python" && specifier.startsWith(".");
  const modulePath =
    language === "python"
      ? specifier.replace(/^\.+/, "").replaceAll(".", "/")
      : specifier;
  const base = normalize(
    `${pythonRelative || specifier.startsWith(".") ? dirname(from) : ""}/${modulePath}`,
  );
  const candidates =
    language === "python"
      ? [`${base}.py`, `${base}/__init__.py`]
      : [
          base,
          ...[".ts", ".tsx", ".js", ".jsx"].map((ext) => `${base}${ext}`),
          ...[".ts", ".tsx", ".js", ".jsx"].map((ext) => `${base}/index${ext}`),
        ];
  return candidates.find((candidate) => known.has(candidate));
};

const importedNames = (line: string, language: Language) => {
  const match =
    language === "python"
      ? /^\s*from\s+([.\w]+)\s+import\s+(.+)$/.exec(line)
      : /^\s*import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/.exec(line);
  if (!match) return undefined;
  const rawNames = language === "python" ? match[2] : match[1];
  return {
    specifier: language === "python" ? match[1] : match[2],
    names: rawNames.split(",").flatMap((raw) => {
      const name = raw.trim();
      const parsed =
        language === "python"
          ? /^(\w+)(?:\s+as\s+(\w+))?$/.exec(name)
          : /^(\w+)(?:\s+as\s+(\w+))?$/.exec(name);
      return parsed
        ? [{ imported: parsed[1], local: parsed[2] ?? parsed[1] }]
        : [];
    }),
  };
};

/** 同じ解析対象内の静的importだけを解決し、呼び出し側で使う関数要約を作る。 */
export function buildFlowContexts(files: FlowSourceFile[]) {
  const own = new Map<string, Map<string, FunctionSummary>>();
  for (const file of files) {
    const language = languageFor(file.ext);
    if (language) own.set(file.rel, summarizeFunctions(file.lines, language));
  }
  const known = new Set(own.keys());
  const contexts = new Map<string, Map<string, FunctionSummary>>();
  for (const file of files) {
    const language = languageFor(file.ext);
    if (!language) continue;
    const context = new Map(own.get(file.rel) ?? []);
    if (language === "go") {
      const dir = dirname(file.rel);
      for (const [rel, summaries] of own) {
        if (rel !== file.rel && dirname(rel) === dir && rel.endsWith(".go")) {
          for (const [name, summary] of summaries) context.set(name, summary);
        }
      }
    } else {
      for (const line of file.lines) {
        const imported = importedNames(line, language);
        if (!imported) continue;
        const target = resolveLocalModule(
          file.rel,
          imported.specifier,
          language,
          known,
        );
        if (!target) continue;
        const targetSummaries = own.get(target);
        for (const name of imported.names) {
          const summary = targetSummaries?.get(name.imported);
          if (summary) context.set(name.local, summary);
        }
      }
    }
    contexts.set(file.rel, context);
  }
  return contexts;
}

const splitArguments = (value: string) =>
  value.split(",").map((argument) => argument.trim());

const summarizedCall = (
  value: string,
  summaries: Map<string, FunctionSummary>,
) => {
  const match = /^\s*(?:await\s+)?(\w+)\s*\((.*)\)/.exec(value);
  if (!match) return undefined;
  return {
    summary: summaries.get(match[1]),
    arguments: splitArguments(match[2]),
  };
};
const indentation = (line: string) =>
  /^\s*/.exec(line)?.[0].replace(/\t/g, "  ").length ?? 0;
const isElse = (line: string) => /^\s*(?:}\s*)?(?:else\b|elif\b)/.test(line);
const isIf = (line: string, language: Language) =>
  language === "python"
    ? /^\s*(?:if|elif)\b.*:\s*(?:#.*)?$/.test(line)
    : /(?:^\s*|}\s*else\s+)if\b.*{\s*$/.test(line);
const union = (...sets: Set<string>[]) => new Set(sets.flatMap((s) => [...s]));

type Branch = {
  indent: number;
  entry: Set<string>;
  thenState?: Set<string>;
  inElse: boolean;
};

const SINKS: Record<
  Language,
  { rule: string; title: string; pattern: RegExp }[]
> = {
  python: [
    {
      rule: "path-traversal",
      title: "利用者が指定したパスを検証せずファイル操作に使っている",
      pattern: /\b(?:open|send_file|send_from_directory)\s*\(/,
    },
    {
      rule: "ssrf",
      title: "利用者が指定したURLへサーバーからアクセスしている",
      pattern: /\b(?:requests|httpx)\.(?:get|post|put|delete|request)\s*\(/,
    },
    {
      rule: "unsafe-code-or-data",
      title:
        "利用者の入力をコードまたはオブジェクトとして安全確認なしで読み込んでいる",
      pattern: /\b(?:pickle|dill)\.loads?\s*\(/,
    },
    {
      rule: "open-redirect",
      title: "利用者が指定したURLへ検証せずリダイレクトしている",
      pattern: /\bredirect\s*\(/,
    },
  ],
  js: [
    {
      rule: "path-traversal",
      title: "利用者が指定したパスを検証せずファイル操作に使っている",
      pattern: /\b(?:readFile|readFileSync|createReadStream|sendFile)\s*\(/,
    },
    {
      rule: "ssrf",
      title: "利用者が指定したURLへサーバーからアクセスしている",
      pattern: /\b(?:fetch|axios\.(?:get|post|put|delete|request))\s*\(/,
    },
    {
      rule: "unsafe-code-or-data",
      title:
        "利用者の入力をコードまたはオブジェクトとして安全確認なしで読み込んでいる",
      pattern: /\b(?:eval|Function)\s*\(/,
    },
    {
      rule: "open-redirect",
      title: "利用者が指定したURLへ検証せずリダイレクトしている",
      pattern: /\b(?:res|reply)\.redirect\s*\(/,
    },
    {
      rule: "mass-assignment",
      title: "利用者の入力をオブジェクトへ無制限に反映している",
      pattern: /\bObject\.assign\s*\(/,
    },
  ],
  go: [
    {
      rule: "path-traversal",
      title: "利用者が指定したパスを検証せずファイル操作に使っている",
      pattern: /\b(?:os\.)?(?:Open|ReadFile|Create|WriteFile)\s*\(/,
    },
    {
      rule: "ssrf",
      title: "利用者が指定したURLへサーバーからアクセスしている",
      pattern: /\bhttp\.(?:Get|Post|NewRequest|NewRequestWithContext)\s*\(/,
    },
    {
      rule: "dynamic-shell-command",
      title: "外部入力を含む可能性がある文字列をシェルで実行している",
      pattern: /\bexec\.Command(?:Context)?\s*\((?:[^,]+,\s*){1,2}["']-c["']/,
    },
    {
      rule: "open-redirect",
      title: "利用者が指定したURLへ検証せずリダイレクトしている",
      pattern: /\bhttp\.Redirect\s*\(/,
    },
  ],
};

/** 同じ関数の中だけでHTTP入力の代入を追う。分岐後は全経路の和を取り、1経路でも危険なら残す。 */
export function flowFindings(
  lines: string[],
  ext: string,
  importedSummaries?: Map<string, FunctionSummary>,
): DetectorFinding[] {
  const language = languageFor(ext);
  if (!language) return [];
  let tainted = new Set<string>();
  const summaries = importedSummaries ?? summarizeFunctions(lines, language);
  const branches: Branch[] = [];
  const out: DetectorFinding[] = [];

  lines.forEach((line, idx) => {
    if (functionStart(line, language)) {
      tainted.clear();
      branches.length = 0;
    }
    const indent = indentation(line);
    const elseLine = isElse(line);
    while (branches.length) {
      const branch = branches[branches.length - 1];
      if (indent > branch.indent || !line.trim()) break;
      if (elseLine && indent === branch.indent && !branch.inElse) {
        branch.thenState = new Set(tainted);
        branch.inElse = true;
        tainted = new Set(branch.entry);
        break;
      }
      branches.pop();
      tainted = branch.inElse
        ? union(branch.thenState ?? new Set(), tainted)
        : union(branch.entry, tainted);
    }
    const assigned = assignment(line, language);
    if (assigned) {
      const call = summarizedCall(assigned.value, summaries);
      if (SANITIZERS.test(assigned.value) || call?.summary?.sanitizes) {
        tainted.delete(assigned.name);
      } else if (
        SOURCES[language].test(assigned.value) ||
        call?.summary?.source ||
        [...(call?.summary?.parameterIndexes ?? [])].some((index) =>
          [...tainted].some((name) =>
            containsName(call?.arguments[index] ?? "", name),
          ),
        ) ||
        [...tainted].some((name) => containsName(assigned.value, name))
      ) {
        tainted.add(assigned.name);
      } else {
        tainted.delete(assigned.name);
      }
    }
    if (language === "js") {
      const callback =
        /([\w.]+)\.(?:forEach|map|filter|some|every|find)\s*\(\s*(?:async\s*)?\(?\s*(\w+)/.exec(
          line,
        );
      if (
        callback &&
        (SOURCES.js.test(callback[1]) ||
          [...tainted].some((name) => containsName(callback[1], name)))
      ) {
        tainted.add(callback[2]);
      }
    }
    for (const sink of SINKS[language]) {
      const sinkAt = line.search(sink.pattern);
      if (
        sinkAt >= 0 &&
        [...tainted].some((name) => containsName(line.slice(sinkAt), name))
      ) {
        out.push({ rule: sink.rule, title: sink.title, idx });
      }
    }
    if (isIf(line, language)) {
      branches.push({
        indent,
        entry: new Set(tainted),
        inElse: false,
      });
    }
  });
  return out;
}
