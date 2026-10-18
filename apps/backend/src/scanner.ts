/**
 * コードから「根拠になる箇所」を機械的に拾う簡易スキャナ。
 *
 * AI にいきなり脆弱性を探させると、ありもしない問題を言い出すことがある。
 * そこで二段構えにする。
 * 1. 機械のルールで該当行を拾い、AI にはその行を根拠に「運用で何が起きるか」を説明させる。
 * 2. ルールが拾えない欠陥は、AI に追加の候補を出させる。引用した行が実際のコードに実在するものだけ採用する (extra.ts)。
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { iterCodeFiles, splitLines } from "./scanner-files";
import { buildFlowContexts, flowFindings } from "./scanner-security";

export { CODE_EXT, splitLines } from "./scanner-files";

export type Finding = {
  id: string;
  rule: string;
  title: string;
  file: string;
  line: number;
  snippet: string;
  /** 未設定は scanner。ai は AI の追加候補のうち、引用が実在したもの */
  origin?: "scanner" | "ai";
  /** AI 由来のとき、運用で何が起きるかの一文 */
  why?: string;
};

/** スキャナ由来 (origin が ai でない) の finding だけ */
export function scannerFindings<F extends { origin?: string }>(fs: F[]): F[] {
  return fs.filter((f) => f.origin !== "ai");
}

type Rule = {
  rule: string;
  title: string;
  pattern: RegExp;
  /** 未指定なら全コード拡張子。言語固有構文の誤検知を防ぐために使う */
  extensions?: ReadonlySet<string>;
  ignoreValue?: RegExp;
  ignoreLine?: (line: string) => boolean;
};

const PYTHON_EXT = new Set([".py"]);
const JS_EXT = new Set([".js", ".jsx", ".ts", ".tsx"]);
const GO_EXT = new Set([".go"]);
const PYTHON_SOURCE = String.raw`request\.(?:args|form|json|values|data|files|get_data\(\))`;
const JS_SOURCE = String.raw`req\.(?:query|body|params|headers|cookies)`;
const GO_SOURCE = String.raw`r\.(?:URL\.Query\(\)\.Get|FormValue|PostFormValue|Header\.Get)`;
const onSameLine = (left: string, right: string) =>
  new RegExp(`^(?=.*${left})(?=.*${right})`);

// ルールの追加基準: 1行から決定的に分かり、誤検知が少ないものだけ。迷うものは AI に任せる。
// 呼び出しの名前 (execute や query) ではなく、危険な操作そのもの (SQL を連結する・MD5 でハッシュする) で書く。
// q の引用符で囲まれた1つの文字列リテラルの中だけで SQL の形を探す (同じ行の別のリテラルをまたがない)
const sqlLiteral = (q: string) =>
  `[^${q}]*?(?:SELECT\\b[^${q}]*?\\bFROM\\b|INSERT\\s+INTO\\b|UPDATE\\s+\\w+\\s+SET\\b|DELETE\\s+FROM\\b)[^${q}]*`;
const SECRET_COMPARE =
  /(?:(?:api[_-]?key|secret|token|password|passwd)[\w"'\])(.[]*\s*(?:===?|!==?)(?!\s*(?:(?:None|null|nil|undefined)\b|["']{2}))|(?<![=!<>])(?<!(?:\b(?:None|null|nil|undefined)|["']{2})\s*)(?:===?|!==?)(?!\s*(?:(?:None|null|nil|undefined)\b|["']{2}))\s*[\w."'[\]()-]*?(?:api[_-]?key|secret|token|password|passwd))/i;
const withoutStringLiterals = (line: string) =>
  line.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
const RULES: Rule[] = [
  {
    rule: "sql-string-build",
    title: "SQLを文字列の連結で組み立てている",
    // SQL の形の文字列リテラルに変数をつなぐ形: "…" + 変数 (直後が文字列なら定数の連結なので除く)・f 文字列の {・テンプレートリテラルの ${・% / .format
    pattern: new RegExp(
      [
        ...['"', "'"].flatMap((q) => [
          `${q}${sqlLiteral(q)}${q}\\s*\\+\\s*(?!["'\`])\\S`,
          `\\bf${q}${sqlLiteral(q)}\\{`,
          `${q}${sqlLiteral(q)}${q}\\s+%\\s*[\\w(]`,
          `${q}${sqlLiteral(q)}${q}\\s*\\.format\\(`,
        ]),
        `\`[^\`]*?(?:SELECT\\b[^\`]*?\\bFROM\\b|INSERT\\s+INTO\\b|UPDATE\\s+\\w+\\s+SET\\b|DELETE\\s+FROM\\b)[^\`]*\\$\\{`,
      ].join("|"),
      "i",
    ),
  },
  {
    rule: "hardcoded-secret",
    title: "APIキーやパスワードをコードに直接書いている",
    pattern:
      /(api_?key|secret|password|passwd|token)\w*\s*(?::=|[:=])\s*["'](?<val>[^"'\s]{8,})["']/i,
    // 明らかなプレースホルダだけ捨てる ("prod-test-..." のような本物は残し、判断は AI の dismissed に任せる)
    ignoreValue:
      /^(test|dummy|example|sample|placeholder|changeme|fake|mock)([-_.].*)?$|^your[-_]|^x{4,}$|^<.*>$|^\$\{.*\}$/i,
  },
  {
    rule: "debug-enabled",
    title: "デバッグモードのまま公開している",
    pattern: /debug\s*[:=]\s*true\b/i,
  },
  {
    rule: "cors-wildcard",
    title: "どのサイトからでもAPIを呼べる設定（CORS *）",
    // origin: "*"・origins = "*"・allow_origins=["*"] と、ヘッダ形式
    pattern:
      /origins?["']?\s*[:=]\s*\[?\s*["']\*["']|Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i,
  },
  {
    rule: "weak-password-hash",
    title: "パスワードを MD5/SHA-1 でハッシュしている（破られやすい）",
    // 同じ行に md5/sha1 と password 系の語が両方ある行 (チェックサムや ETag の md5 は拾わない)
    pattern: /^(?=.*(?:md5|sha-?1)(?!\d))(?=.*\b(?:password|passwd|pwd|pw)\b)/i,
  },
  {
    rule: "stack-leak",
    title: "エラーのスタックトレースを利用者に返している",
    // 応答に出す行だけ。console.error(err.stack) のようなログ出力は拾わない
    pattern:
      /^(?!.*\b(?:console|logger|logging|log)\.\w+\s*\()(?=.*\b(?:send|json|jsonify|return|write)\b)(?=.*(?:\b(?:err|error|e|ex)\.stack\b|traceback\.format_exc\(\)))/i,
  },
  {
    rule: "stack-leak",
    title: "エラーのスタックトレースを利用者に返している",
    extensions: GO_EXT,
    // debug.Stack() の結果をHTTP応答へ直接書く形。ログへの出力は対象外
    pattern:
      /(?:\b(?:w|writer|response)\.Write\s*\(\s*debug\.Stack\(\)|\bhttp\.Error\s*\([^,]+,\s*string\s*\(\s*debug\.Stack\(\))/,
  },
  {
    rule: "tls-verification-disabled",
    title: "TLS証明書の検証を無効にしている",
    pattern:
      /\bverify\s*=\s*False\b|\brejectUnauthorized\s*:\s*false\b|\bInsecureSkipVerify\s*:\s*true\b/,
  },
  {
    rule: "dynamic-shell-command",
    title: "外部入力を含む可能性がある文字列をシェルで実行している",
    extensions: PYTHON_EXT,
    // 固定文字列は除き、f文字列・連結・format・変数を shell=True / os.system へ渡す形だけ
    pattern:
      /\bos\.system\s*\(\s*(?:f["']|\w)|\bsubprocess\.\w+\s*\(\s*(?:f["'][^"']*["']|["'][^"']*["']\s*\+\s*\w+|\w+)\s*,.*\bshell\s*=\s*True/,
  },
  {
    rule: "path-traversal",
    title: "利用者が指定したパスを検証せずファイル操作に使っている",
    extensions: PYTHON_EXT,
    pattern: onSameLine(
      String.raw`\b(?:open|send_file|send_from_directory)\s*\(`,
      PYTHON_SOURCE,
    ),
  },
  {
    rule: "path-traversal",
    title: "利用者が指定したパスを検証せずファイル操作に使っている",
    extensions: JS_EXT,
    pattern: onSameLine(
      String.raw`\b(?:readFile|readFileSync|createReadStream|sendFile)\s*\(`,
      JS_SOURCE,
    ),
  },
  {
    rule: "path-traversal",
    title: "利用者が指定したパスを検証せずファイル操作に使っている",
    extensions: GO_EXT,
    pattern: onSameLine(
      String.raw`\b(?:os\.)?(?:Open|ReadFile|Create|WriteFile)\s*\(`,
      GO_SOURCE,
    ),
  },
  {
    rule: "ssrf",
    title: "利用者が指定したURLへサーバーからアクセスしている",
    extensions: PYTHON_EXT,
    pattern: onSameLine(
      String.raw`\b(?:requests|httpx)\.(?:get|post|put|delete|request)\s*\(`,
      PYTHON_SOURCE,
    ),
  },
  {
    rule: "ssrf",
    title: "利用者が指定したURLへサーバーからアクセスしている",
    extensions: JS_EXT,
    pattern: onSameLine(
      String.raw`\b(?:fetch|axios\.(?:get|post|put|delete|request))\s*\(`,
      JS_SOURCE,
    ),
  },
  {
    rule: "ssrf",
    title: "利用者が指定したURLへサーバーからアクセスしている",
    extensions: GO_EXT,
    pattern: onSameLine(
      String.raw`\bhttp\.(?:Get|Post|NewRequest|NewRequestWithContext)\s*\(`,
      GO_SOURCE,
    ),
  },
  {
    rule: "unsafe-code-or-data",
    title:
      "利用者の入力をコードまたはオブジェクトとして安全確認なしで読み込んでいる",
    extensions: PYTHON_EXT,
    pattern: onSameLine(
      String.raw`\b(?:pickle|dill)\.loads?\s*\(`,
      PYTHON_SOURCE,
    ),
  },
  {
    rule: "unsafe-code-or-data",
    title:
      "利用者の入力をコードまたはオブジェクトとして安全確認なしで読み込んでいる",
    extensions: JS_EXT,
    pattern: onSameLine(String.raw`\b(?:eval|Function)\s*\(`, JS_SOURCE),
  },
  {
    rule: "dynamic-shell-command",
    title: "外部入力を含む可能性がある文字列をシェルで実行している",
    extensions: GO_EXT,
    pattern: onSameLine(
      String.raw`\bexec\.Command(?:Context)?\s*\((?:[^,]+,\s*){1,2}["']-c["']`,
      GO_SOURCE,
    ),
  },
  {
    rule: "open-redirect",
    title: "利用者が指定したURLへ検証せずリダイレクトしている",
    extensions: PYTHON_EXT,
    pattern: onSameLine(String.raw`\bredirect\s*\(`, PYTHON_SOURCE),
  },
  {
    rule: "open-redirect",
    title: "利用者が指定したURLへ検証せずリダイレクトしている",
    extensions: JS_EXT,
    pattern: onSameLine(String.raw`\b(?:res|reply)\.redirect\s*\(`, JS_SOURCE),
  },
  {
    rule: "open-redirect",
    title: "利用者が指定したURLへ検証せずリダイレクトしている",
    extensions: GO_EXT,
    pattern: onSameLine(String.raw`\bhttp\.Redirect\s*\(`, GO_SOURCE),
  },
  {
    rule: "mass-assignment",
    title: "利用者の入力をオブジェクトへ無制限に反映している",
    extensions: JS_EXT,
    pattern: /\bObject\.assign\s*\([^,]+,\s*req\.body\s*[,)]/,
  },
  {
    rule: "pii-in-logs",
    title: "ログに個人情報を書き出している",
    pattern:
      /(log(ger)?\.\w+|print|console\.log)\s*\(.*(email|phone|tel|address|password)/i,
  },
  {
    rule: "relative-path",
    title: "ファイルの場所を相対パスで書いている（起動する場所によって変わる）",
    pattern:
      /\b\w*(path|file|dir)\w*\s*=\s*["'](?![/~$]|[A-Za-z]:)[^"'\s{}]+\.(db|sqlite3?|json|csv|log|txt)["']/i,
  },
  {
    rule: "secret-compare",
    title: "秘密の値を == で比べている（比較時間の差から推測される）",
    // 秘密っぽい名前が ==/!= の片側にある行。None・null・"" との比較 (有無の確認) は拾わない
    pattern: SECRET_COMPARE,
    // 環境変数名など、引用符内に secret/token があるだけの行は秘密値の比較ではない
    ignoreLine: (line) => !SECRET_COMPARE.test(withoutStringLiterals(line)),
  },
  {
    rule: "select-all-columns",
    title: "全カラム（SELECT *）をそのまま返している",
    pattern: /SELECT\s+\*\s+FROM/i,
  },
];

const AUTH_WORDS =
  /check_key|login_required|auth|token|Depends\(|permission|verify/i;
const ROUTE_RE =
  /^\s*@\w+\.(route|get|post|put|delete|patch)\(\s*["']([^"']+)["']/;

export function snippet(lines: string[], idx: number, around = 2): string {
  const lo = Math.max(0, idx - around);
  const hi = Math.min(lines.length, idx + around + 1);
  const out: string[] = [];
  for (let n = lo; n < hi; n++) {
    out.push(`${String(n + 1).padStart(4)}  ${lines[n]}`);
  }
  return out.join("\n");
}

/** finding.snippet のうち、finding.line の行の文字列 (`  NN  <行>` 形式の番号を除いたもの) */
export function findingLine(f: Finding): string {
  const m = new RegExp(`^\\s*${f.line}  (.*)$`, "m").exec(f.snippet);
  return m?.[1] ?? "";
}

/** Python のルート定義で、関数の中に認証チェックが見当たらないもの */
function routeWithoutAuth(lines: string[]) {
  const out: { rule: string; title: string; idx: number }[] = [];
  lines.forEach((line, i) => {
    const m = ROUTE_RE.exec(line);
    if (!m) return;
    const body: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      if (
        j > i + 1 &&
        (ROUTE_RE.test(lines[j]) || /^(def |class |if __name__)/.test(lines[j]))
      ) {
        break;
      }
      body.push(lines[j]);
    }
    if (!AUTH_WORDS.test(body.join("\n"))) {
      out.push({
        rule: "route-without-auth",
        title: `認証なしで呼べるAPI（${m[2]}）`,
        idx: i,
      });
    }
  });
  return out;
}

const CONNECT_RE = /(sqlite3|psycopg2|pymysql|mysql\.connector)\.connect\(/;
const ASSIGN_RE = /^\s*(\w+)\s*(?::[^=]+)?=/;
const DEF_RE = /^\s*(?:async\s+)?def\s/;

/** DB 接続を開いているのに、その変数の close() も closing() も無いもの (with は commit するだけで閉じないので閉じたとは見ない) */
// shortcut: Python の4つのドライバだけ・変数名で対応づける (別の関数が返した接続を呼び側で閉じる形は誤検知になる)。他言語は未対応、足すなら言語ごとの接続関数を CONNECT_RE に足す
function unclosedConnection(lines: string[]) {
  const out: { rule: string; title: string; idx: number }[] = [];
  lines.forEach((line, idx) => {
    if (CONNECT_RE.test(line) && !/\bclosing\(/.test(line)) {
      const name = ASSIGN_RE.exec(line)?.[1];
      // 同じ変数名 (conn など) を別の関数が閉じていても免除しない: 囲む関数の中だけ見る
      let lo = idx;
      while (lo > 0 && !DEF_RE.test(lines[lo])) lo--;
      let hi = idx + 1;
      while (hi < lines.length && !DEF_RE.test(lines[hi])) hi++;
      if (
        name &&
        lines.slice(lo, hi).some((l) => l.includes(`${name}.close()`))
      )
        return;
      out.push({
        rule: "unclosed-connection",
        title: "DBの接続を開いたまま閉じていない",
        idx,
      });
    }
  });
  return out;
}

const CHILD_PROCESS_MODULE = `["'](?:node:)?child_process["']`;
const DYNAMIC_COMMAND =
  /\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+\s*\w|\w+\s*[,)]|\w+\s*\+)/;
const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** child_process から読み込んだ exec/execSync に動的な文字列を渡す呼び出しだけを拾う */
function dynamicShellCommandsJs(lines: string[]) {
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  for (const line of lines) {
    const namedImport = new RegExp(
      String.raw`\bimport\s*\{([^}]+)\}\s*from\s*${CHILD_PROCESS_MODULE}`,
    ).exec(line);
    const namedRequire = new RegExp(
      String.raw`\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*${CHILD_PROCESS_MODULE}\s*\)`,
    ).exec(line);
    for (const spec of (namedImport?.[1] ?? namedRequire?.[1] ?? "").split(
      ",",
    )) {
      const m = /^\s*(exec|execSync)(?:(?:\s+as\s+|\s*:\s*)(\w+))?\s*$/.exec(
        spec,
      );
      if (m) functions.add(m[2] ?? m[1]);
    }
    const namespaceImport = new RegExp(
      String.raw`\bimport\s*\*\s*as\s*(\w+)\s*from\s*${CHILD_PROCESS_MODULE}`,
    ).exec(line);
    const namespaceRequire = new RegExp(
      String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*${CHILD_PROCESS_MODULE}\s*\)`,
    ).exec(line);
    if (namespaceImport) namespaces.add(namespaceImport[1]);
    if (namespaceRequire) namespaces.add(namespaceRequire[1]);
  }

  const out: { rule: string; title: string; idx: number }[] = [];
  lines.forEach((line, idx) => {
    const callees = [
      ...[...functions].map(regexEscape),
      ...[...namespaces].map((n) => `${regexEscape(n)}\\.(?:exec|execSync)`),
    ];
    if (
      callees.length &&
      new RegExp(
        String.raw`\b(?:${callees.join("|")})${DYNAMIC_COMMAND.source}`,
      ).test(line)
    ) {
      out.push({
        rule: "dynamic-shell-command",
        title: "外部入力を含む可能性がある文字列をシェルで実行している",
        idx,
      });
    }
  });
  return out;
}

/** 1行だけでは用途が決まらない弱い乱数と、アーカイブ内の名前を使う展開先を周辺文脈込みで拾う */
function contextualSecurityFindings(lines: string[], ext: string) {
  const out: { rule: string; title: string; idx: number }[] = [];
  const whole = lines.join("\n");
  const weakRandom =
    ext === ".py"
      ? /\b(?:random\.(?:random|randint|randrange|choice)|uuid\.uuid1)\s*\(/
      : JS_EXT.has(ext)
        ? /\bMath\.random\s*\(/
        : ext === ".go" && /["']math\/rand["']/.test(whole)
          ? /\brand\.(?:Int|Intn|Int31|Int63|Float32|Float64|Read)\s*\(/
          : null;
  const securityPurpose =
    /token|reset|session|csrf|nonce|otp|verification|auth|password|secret|code/i;
  const archivePath =
    /(?:filepath\.Join|path\.join|joinpath|\s\/\s).*\.(?:filename|name)\b/i;
  const archiveContext =
    /\b(?:zip|tar|archive|infolist|getmembers)\b|\.File\b/i;

  lines.forEach((line, idx) => {
    const context = lines.slice(Math.max(0, idx - 5), idx + 1).join("\n");
    if (weakRandom?.test(line) && securityPurpose.test(context)) {
      out.push({
        rule: "weak-security-randomness",
        title: "推測しやすい乱数を認証用の値に使っている",
        idx,
      });
    }
    if (archivePath.test(line) && archiveContext.test(context)) {
      out.push({
        rule: "archive-path-traversal",
        title: "アーカイブ内のパスを検証せず展開先に使っている",
        idx,
      });
    }
  });
  return out;
}

export function scan(root: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (
    rule: string,
    title: string,
    rel: string,
    lines: string[],
    idx: number,
  ) => {
    const key = `${rule}\0${rel}\0${idx}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      id: `F${findings.length + 1}`,
      rule,
      title,
      file: rel,
      line: idx + 1,
      snippet: snippet(lines, idx),
    });
  };

  const files = iterCodeFiles(root).map((file) => ({
    ...file,
    ext: extname(file.name),
    lines: splitLines(readFileSync(file.abs, "utf8")),
  }));
  const flowContexts = buildFlowContexts(files);
  for (const f of files) {
    const { lines, ext } = f;
    lines.forEach((line, i) => {
      for (const r of RULES) {
        if (r.extensions && !r.extensions.has(ext)) continue;
        let hit = r.pattern.exec(line);
        // ダミー値は拾わない
        if (
          hit &&
          (r.ignoreValue?.test(hit.groups?.val ?? "") || r.ignoreLine?.(line))
        )
          hit = null;
        if (hit) add(r.rule, r.title, f.rel, lines, i);
      }
    });
    if (extname(f.name) === ".py") {
      for (const r of [
        ...routeWithoutAuth(lines),
        ...unclosedConnection(lines),
      ]) {
        add(r.rule, r.title, f.rel, lines, r.idx);
      }
    }
    if (JS_EXT.has(ext)) {
      for (const r of dynamicShellCommandsJs(lines)) {
        add(r.rule, r.title, f.rel, lines, r.idx);
      }
    }
    for (const r of contextualSecurityFindings(lines, ext)) {
      add(r.rule, r.title, f.rel, lines, r.idx);
    }
    for (const r of flowFindings(lines, ext, flowContexts.get(f.rel))) {
      add(r.rule, r.title, f.rel, lines, r.idx);
    }
  }
  return findings;
}

export {
  extractFeatures,
  type Feature,
  readConfig,
  readSources,
  relocate,
  snapshotTarget,
} from "./scanner-context";
