import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  extractFeatures,
  readConfig,
  readSources,
  relocate,
  scan,
  snapshotTarget,
} from "../src/scanner";
import {
  AI_REQUIRED_COVERAGE,
  MECHANICAL_COVERAGE,
} from "../src/scanner-security";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scanner-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, body: string) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

test("extractFeatures", () => {
  put(
    "bot.py",
    [
      '@app_commands.command(name="rank", description="x")',
      "async def rank(i): ...",
      "@bot.command()",
      "async def ping(ctx): ...",
      "@bot.event",
      "async def on_message(m): ...",
      "@tasks.loop(hours=1)",
      "async def hourly(): ...",
      "",
    ].join("\n"),
  );
  put("api.py", '@router.post("/items")\ndef add(): ...\n');
  put("srv.js", "app.get('/health', h);\nclient.on('messageCreate', f);\n");
  put("pages/Home.tsx", '<Route path="/home" />\n');
  put("tests/test_x.py", '@app.get("/ignored")\n');

  const feats = extractFeatures(root);
  const names = feats.map((f) => f.name);
  for (const want of [
    "コマンド: rank",
    "コマンド: ping",
    "イベント: on_message",
    "定期実行: hourly",
    "ルート: /items (post)",
    "ルート: /health (get)",
    "イベント: messageCreate",
    "画面: pages/Home.tsx",
    "画面: /home",
  ]) {
    expect(names).toContain(want);
  }
  expect(names.some((n) => n.includes("ignored"))).toBe(false);
  expect(new Set(names).size).toBe(names.length);
  expect(feats.map((f) => f.id)).toEqual(feats.map((_, i) => `f${i + 1}`));
  expect(extractFeatures(root)).toEqual(feats);
});

test("scan: 代表ルールが検出され、ダミー値とテストは除外される", () => {
  put(
    "app.py",
    [
      "from x import y",
      "DEBUG = True",
      'api_key = "sk-live-abcdef123456"',
      'api_key = "test-abcdef123456"',
      'db.execute("SELECT * FROM t WHERE id=" + uid)',
      "print(user.email)",
      'CORS(app, origins="*")',
      "",
    ].join("\n"),
  );
  put("tests/test_app.py", "DEBUG = True\n");
  put("node_modules/x/index.js", "DEBUG = True\n");

  const found = scan(root);
  const byRule = (r: string) => found.filter((f) => f.rule === r);
  expect(byRule("debug-enabled").map((f) => f.line)).toEqual([2]);
  expect(byRule("hardcoded-secret").map((f) => f.line)).toEqual([3]);
  expect(byRule("sql-string-build").map((f) => f.line)).toEqual([5]);
  expect(byRule("select-all-columns").map((f) => f.line)).toEqual([5]);
  expect(byRule("pii-in-logs").map((f) => f.line)).toEqual([6]);
  expect(byRule("cors-wildcard").map((f) => f.line)).toEqual([7]);
  expect(found.every((f) => f.file === "app.py")).toBe(true);
  expect(found.map((f) => f.id)).toEqual(found.map((_, i) => `F${i + 1}`));
  expect(found[0].snippet).toContain("   1  from x import y");
});

test("scan: 認証なしのルートだけ拾う / 複数行のSQLも拾う", () => {
  put(
    "api.py",
    [
      '@app.get("/open")',
      "def open_(): ...",
      '@app.get("/closed")',
      "def closed(user=Depends(auth)): ...",
      "db.execute(",
      '    "SELECT a FROM t WHERE x=" + v',
      ")",
      "",
    ].join("\n"),
  );
  const found = scan(root);
  expect(
    found.filter((f) => f.rule === "route-without-auth").map((f) => f.title),
  ).toEqual(["認証なしで呼べるAPI（/open）"]);
  expect(found.filter((f) => f.rule === "sql-string-build")).toHaveLength(1);
});

test("scan: secret-compare は秘密の == 比較だけ拾い、有無の確認は拾わない", () => {
  put(
    "a.py",
    [
      'ok = request.headers.get("X-API-Key") == PARTNER_API_KEY', // 1
      "if provided_token != expected:", // 2
      "if token == None:", // 3
      'if password == "":', // 4
      "if token is None:", // 5
      "if limit >= token_max:", // 6
      "x = secret_value", // 7
      "if user === api_key:", // 8
      "if None != api_key:", // 9
      "if null === token:", // 10
      "",
    ].join("\n"),
  );
  const lines = scan(root)
    .filter((f) => f.rule === "secret-compare")
    .map((f) => f.line);
  expect(lines).toEqual([1, 2, 8]);
});

test("scan: unclosed-connection は閉じていない接続だけ拾う", () => {
  put("open.py", "import sqlite3\nconn = sqlite3.connect(P)\n");
  put("closed.py", "import sqlite3\nconn = sqlite3.connect(P)\nconn.close()\n");
  // with は commit するだけで閉じない
  put("with.py", "import sqlite3\nwith sqlite3.connect(P) as c:\n    pass\n");
  put(
    "closing.py",
    "import sqlite3\nc = contextlib.closing(sqlite3.connect(P))\n",
  );
  // 1つ閉じていても、別の接続が閉じていなければ拾う。無関係な close() では免除しない
  put(
    "mixed.py",
    "import sqlite3\na = sqlite3.connect(P)\nb = sqlite3.connect(Q)\na.close()\nf.close()\n",
  );
  // 別の関数が同じ変数名を閉じていても、こちらは閉じていない
  put(
    "scope.py",
    "import sqlite3\ndef a():\n    conn = sqlite3.connect(P)\n    conn.close()\ndef b():\n    conn = sqlite3.connect(P)\n    return conn\n",
  );
  const found = scan(root).filter((f) => f.rule === "unclosed-connection");
  expect(found.map((f) => `${f.file}:${f.line}`)).toEqual([
    "mixed.py:3",
    "open.py:2",
    "scope.py:6",
    "with.py:2",
  ]);
});

test("relocate: 行がずれても snippet の行で探し直す", () => {
  put("app.py", "import os\n\n\nDEBUG = True\n");
  const [f] = scan(root);
  put("app.py", "# a\n# b\nimport os\n\n\nDEBUG = True\n");
  expect(relocate(root, [f])[0].line).toBe(f.line + 2);
  expect(relocate(root, [{ ...f, file: "missing.py" }])[0].line).toBe(f.line);
});

test("readSources: 指摘ファイルが先頭、入りきらないものはフォルダごとに列挙", () => {
  put("a.py", "x = 1\n");
  put("b.py", "y = 2\n");
  put("sub/c.py", `z = 3\n${"# pad\n".repeat(50)}`);
  const full = readSources(root, 60_000, [{ file: "b.py", line: 1 }]);
  expect(full.indexOf("### b.py")).toBeLessThan(full.indexOf("### a.py"));
  expect(full).toContain("   1  y = 2");

  const small = readSources(root, 40, [{ file: "b.py", line: 1 }]);
  expect(small).toContain("### b.py");
  expect(small).toContain("中身を省略したファイル");
  expect(small).toContain("sub/ (1): c.py");
});

test("readConfig: 秘密の値を伏せる", () => {
  put(
    "docker-compose.yml",
    "services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: hunter2\n    image: x@sha256:" +
      "a".repeat(64) +
      "\n  app:\n    environment:\n      DATABASE_URL: postgres://u:pw123@db/x\n",
  );
  put("docker-compose.dev.yml", "services: {}\n");
  put(".env.example", "API_KEY=sk-real-value\nPORT=3000\n");
  put(".env", "SECRET=should-not-be-read\n");
  put("README.md", "# hi\n");
  put("docs/README.md", "# deeper\n");

  const out = readConfig(root);
  expect(out).toContain("POSTGRES_PASSWORD: …");
  expect(out).toContain("postgres://u:…@db/x");
  expect(out).toContain("API_KEY=…");
  expect(out).toContain("PORT=…");
  expect(out).not.toContain("hunter2");
  expect(out).not.toContain("pw123");
  expect(out).not.toContain("sk-real-value");
  expect(out).not.toContain("sha256");
  expect(out).not.toContain("should-not-be-read");
  expect(out).not.toContain("docker-compose.dev.yml");
  expect(out).not.toContain("deeper");
  expect(out.indexOf("docker-compose.yml")).toBeLessThan(out.indexOf("README"));
});

test("snapshotTarget: 自分自身・node_modules・data・symlink を除いてコピーし、内側のコピー先でも止まる", () => {
  put("app/main.py", "print(1)\n");
  put("app/node_modules/x.js", "x\n");
  put("app/.git/HEAD", "ref\n");
  put("data/secret.db", "db\n");
  put("tka_2607/index.ts", "self\n");
  put("other/data/keep.txt", "nested data is kept\n");
  symlinkSync(join(root, "app/main.py"), join(root, "link.py"));

  const dest = join(root, "tka_2607/data/projects/p1"); // 対象の内側 (除外された自分自身のさらに内側)
  snapshotTarget(root, dest, [join(root, "tka_2607")]);
  expect(existsSync(join(dest, "app/main.py"))).toBe(true);
  expect(existsSync(join(dest, "other/data/keep.txt"))).toBe(true);
  expect(existsSync(join(dest, "app/node_modules"))).toBe(false);
  expect(existsSync(join(dest, "app/.git"))).toBe(false);
  expect(existsSync(join(dest, "data"))).toBe(false);
  expect(existsSync(join(dest, "tka_2607"))).toBe(false);
  expect(existsSync(join(dest, "link.py"))).toBe(false);

  // 除外に自分自身を渡さなくても、コピー先が対象の内側なら再帰しない
  const dest2 = join(root, "snap2");
  snapshotTarget(root, dest2, []);
  expect(existsSync(join(dest2, "app/main.py"))).toBe(true);
  expect(existsSync(join(dest2, "snap2"))).toBe(false);
});

// biome-ignore lint/style/useTemplate: 検査対象の ${...} をテスト自身の補間にしないため分割する
const jsInterpolation = (name: string) => `$` + `{${name}}`;

// ルールごとの [当たる行, 当たらない行]。書き方でなく危険な操作で当たることを言語別に確かめる
const RULE_CASES: Record<string, { hit: string[]; miss: string[] }> = {
  "sql-string-build": {
    hit: [
      `db.prepare("SELECT * FROM users WHERE email = '" + email + "'")`,
      `cur.execute(f"DELETE FROM t WHERE id = {i}")`,
      `db.query(\`SELECT * FROM t WHERE id = ${jsInterpolation("id")}\`)`,
      `cursor.execute("SELECT * FROM t WHERE id = %s" % uid)`,
      `q := "UPDATE t SET a = " + a`,
      `sql = "INSERT INTO t VALUES ({})".format(v)`,
    ],
    miss: [
      `db.prepare("SELECT * FROM t WHERE id = ?")`,
      `log("Update failed: " + reason)`,
      `q = "SELECT * FROM t " + "WHERE id = ?"`,
      `cur.execute("SELECT * FROM t WHERE name LIKE '%x%'")`,
      // 同じ行の別のリテラルの連結を、SQL の連結と取り違えない
      `db.query("SELECT * FROM t WHERE id = ?", id); log("x" + reason)`,
    ],
  },
  "cors-wildcard": {
    hit: [
      `app.use(cors({ origin: "*" }))`,
      `allow_origins=["*"]`,
      `origins = "*"`,
      `res.setHeader("Access-Control-Allow-Origin", "*")`,
    ],
    miss: [
      `origin: "https://example.com"`,
      `allow_origins=["https://example.com"]`,
      `const star = "*"`,
    ],
  },
  "debug-enabled": {
    hit: [`app.run(debug=True)`, `const cfg = { debug: true }`, `DEBUG = True`],
    miss: [`debug: false`, `app.run(debug=False)`, `const debugger_on = 1`],
  },
  "weak-password-hash": {
    hit: [
      `crypto.createHash("md5").update(password)`,
      `hashlib.md5(pw.encode())`,
      `h := sha1.Sum([]byte(passwd))`,
    ],
    miss: [
      `crypto.createHash("md5").update(fileBytes)`,
      `bcrypt.hash(password, 12)`,
      `crypto.createHash("sha256").update(password)`,
    ],
  },
  "stack-leak": {
    hit: [
      `res.status(500).send(err.stack)`,
      `return jsonify(error=traceback.format_exc())`,
      `res.json({ message: error.stack })`,
    ],
    miss: [
      `console.error(err.stack)`,
      `logger.error(traceback.format_exc())`,
      `res.status(500).send("error")`,
    ],
  },
  "tls-verification-disabled": {
    hit: [
      `requests.get(url, verify=False)`,
      `const agent = new https.Agent({ rejectUnauthorized: false })`,
      `TLSClientConfig: &tls.Config{InsecureSkipVerify: true}`,
    ],
    miss: [
      `requests.get(url, verify=True)`,
      `rejectUnauthorized: true`,
      `InsecureSkipVerify: false`,
    ],
  },
};

test("ルールごとに、危険な操作の行は当たり、安全な行は当たらない", () => {
  const cases = Object.entries(RULE_CASES).flatMap(([rule, c]) => [
    ...c.hit.map((line) => ({ rule, line, want: true })),
    ...c.miss.map((line) => ({ rule, line, want: false })),
  ]);
  cases.forEach((c, i) => {
    put(`c${i}.ts`, `${c.line}\n`);
  });
  const found = new Map<string, Set<string>>();
  for (const f of scan(root)) {
    found.set(f.rule, (found.get(f.rule) ?? new Set()).add(f.file));
  }
  for (const rule of Object.keys(RULE_CASES)) {
    const want = cases.flatMap((c, i) =>
      c.rule === rule && c.want ? [`c${i}.ts`] : [],
    );
    expect([...(found.get(rule) ?? [])].sort()).toEqual(want.sort());
  }
});

test("scan: 言語固有ルールは対応言語だけで検出する", () => {
  put("app.py", 'os.system(f"convert {filename}")\n');
  put(
    "app.js",
    `import { exec } from "node:child_process"\nexec(\`convert ${jsInterpolation("filename")}\`)\n`,
  );
  put("app.go", "w.Write(debug.Stack())\n");
  put("not-python.go", 'os.system(f"convert {filename}")\n');
  put("not-js.py", `exec(\`convert ${jsInterpolation("filename")}\`)\n`);
  put("safe.py", 'os.system("date")\n');
  put("safe.js", 'exec("date")\n');
  put("log.go", "log.Print(string(debug.Stack()))\n");

  const found = scan(root);
  expect(
    found.filter((f) => f.rule === "dynamic-shell-command").map((f) => f.file),
  ).toEqual(["app.js", "app.py"]);
  expect(
    found.filter((f) => f.rule === "stack-leak").map((f) => f.file),
  ).toEqual(["app.go"]);
});

test("scan: 精度検査で見つかった見落としと誤検知を防ぐ", () => {
  put("shell.py", 'subprocess.run(f"convert {name}", shell=True)\n');
  put("secret.go", 'secret := "prod_secret_192837465"\n');
  put(
    "child.js",
    'const { exec: run } = require("child_process")\nrun(command)\n',
  );
  put(
    "namespace.ts",
    'import * as cp from "node:child_process"\ncp.execSync("convert " + name)\n',
  );
  put("regexp.ts", 'const m = TIME_RE.exec(String(value ?? ""))\n');
  put(
    "env.ts",
    'e[0] !== "ANTHROPIC_API_KEY" && e[0] !== "ANTHROPIC_AUTH_TOKEN"\n',
  );

  const found = scan(root);
  expect(
    found.filter((f) => f.rule === "dynamic-shell-command").map((f) => f.file),
  ).toEqual(["child.js", "namespace.ts", "shell.py"]);
  expect(
    found.filter((f) => f.rule === "hardcoded-secret").map((f) => f.file),
  ).toEqual(["secret.go"]);
  expect(found.some((f) => f.file === "regexp.ts")).toBe(false);
  expect(found.some((f) => f.file === "env.ts")).toBe(false);
});

test("scan: 別ベクトルを入力源と危険な処理の組み合わせで検出する", () => {
  put("path.py", 'data = open(request.form["filename"], "rb").read()\n');
  put("ssrf.py", 'response = httpx.post(request.args["callback"])\n');
  put("deserialize.py", "value = dill.loads(request.get_data())\n");
  put("redirect.py", 'return redirect(request.values["return_to"])\n');
  put(
    "random.py",
    "def create_session_code():\n    return random.choice(ALPHABET)\n",
  );
  put(
    "archive.py",
    "archive = tarfile.open(src)\nfor info in archive.getmembers():\n    output = base / info.name\n",
  );

  put("path.ts", "createReadStream(req.params.file).pipe(reply)\n");
  put("ssrf.ts", "await axios.post(req.query.webhook)\n");
  put("code.ts", "const fn = Function(req.body.script)\n");
  put("redirect.ts", "reply.redirect(req.headers.location)\n");
  put(
    "random.ts",
    'router.post("/otp", (_req, res) => {\n  res.send(String(Math.random()))\n})\n',
  );
  put("assign.ts", "Object.assign(account, req.body)\n");

  put("path.go", 'f, _ := os.Open(r.FormValue("path"))\n');
  put(
    "ssrf.go",
    'req, _ := http.NewRequest("GET", r.Header.Get("Target"), nil)\n',
  );
  put(
    "shell.go",
    'out, _ := exec.CommandContext(ctx, "bash", "-c", r.PostFormValue("script")).Output()\n',
  );
  put(
    "redirect.go",
    'http.Redirect(w, r, r.FormValue("return_to"), http.StatusSeeOther)\n',
  );
  put(
    "random.go",
    'import "math/rand"\nfunc newCSRFToken() string {\n return strconv.Itoa(rand.Int())\n}\n',
  );
  put(
    "archive.go",
    'import "archive/tar"\nfor _, entry := range archive.File {\n path := filepath.Join(dest, entry.Name)\n}\n',
  );

  const found = scan(root);
  const byRule = (rule: string) =>
    found.filter((f) => f.rule === rule).map((f) => f.file);
  expect(byRule("path-traversal")).toEqual(["path.go", "path.py", "path.ts"]);
  expect(byRule("ssrf")).toEqual(["ssrf.go", "ssrf.py", "ssrf.ts"]);
  expect(byRule("unsafe-code-or-data")).toEqual(["code.ts", "deserialize.py"]);
  expect(byRule("dynamic-shell-command")).toEqual(["shell.go"]);
  expect(byRule("open-redirect")).toEqual([
    "redirect.go",
    "redirect.py",
    "redirect.ts",
  ]);
  expect(byRule("weak-security-randomness")).toEqual([
    "random.go",
    "random.py",
    "random.ts",
  ]);
  expect(byRule("archive-path-traversal")).toEqual([
    "archive.go",
    "archive.py",
  ]);
  expect(byRule("mass-assignment")).toEqual(["assign.ts"]);
});

test("scan: 別ベクトルでも定数と安全なAPIは検出しない", () => {
  put("safe-path.py", 'data = open("/srv/public/help.txt", "rb").read()\n');
  put("safe-http.ts", 'await fetch("https://status.example.com/health")\n');
  put("safe-json.py", "value = json.loads(request.get_data())\n");
  put("safe-redirect.go", 'http.Redirect(w, r, "/login", http.StatusFound)\n');
  put(
    "safe-random.py",
    "def reset_token():\n    return secrets.token_urlsafe(32)\n",
  );
  put("safe-random.ts", "const token = crypto.randomUUID()\n");
  put(
    "safe-random.go",
    'import "crypto/rand"\nfunc newToken() { rand.Read(buf) }\n',
  );
  put("safe-assign.ts", "Object.assign(account, { name: req.body.name })\n");
  put(
    "safe-shell.go",
    'exec.Command("convert", r.FormValue("input"), output).Run()\n',
  );

  expect(scan(root)).toEqual([]);
});

test("scan: 同一関数内では入力を代入した変数を危険処理まで追跡する", () => {
  put(
    "flow.py",
    'def download():\n    supplied = request.args["name"]\n    filename = supplied\n    return send_file(BASE / filename)\n',
  );
  put(
    "flow.ts",
    'app.post("/preview", async (req, res) => {\n  const supplied = req.body.url\n  const target = supplied\n  res.send(await fetch(target))\n})\n',
  );
  put(
    "flow.go",
    'func next(w http.ResponseWriter, r *http.Request) {\n target := r.FormValue("next")\n http.Redirect(w, r, target, 302)\n}\n',
  );

  expect(scan(root).map((f) => `${f.file}:${f.rule}:${f.line}`)).toEqual([
    "flow.go:open-redirect:3",
    "flow.py:path-traversal:4",
    "flow.ts:ssrf:4",
  ]);
});

test("scan: オブジェクトのフィールドを経由する入力を追跡する", () => {
  put(
    "field.py",
    'def download():\n    state = {}\n    state.path = request.args["name"]\n    return send_file(BASE / state.path)\n',
  );
  put(
    "field.ts",
    'app.get("/file", (req, res) => {\n  const state = {}\n  state.url = req.query.url\n  fetch(state.url)\n})\n',
  );
  put(
    "field.go",
    'func download(r *http.Request) {\n var state State\n state.Path = r.FormValue("name")\n os.ReadFile(state.Path)\n}\n',
  );

  expect(scan(root).map((f) => `${f.file}:${f.rule}`)).toEqual([
    "field.go:path-traversal",
    "field.py:path-traversal",
    "field.ts:ssrf",
  ]);
});

test("scan: 同一ファイルの名前付き関数の戻り値を追跡する", () => {
  put(
    "return.py",
    'def input_name():\n    return request.args["name"]\n\ndef identity(value):\n    copy = value\n    return copy\n\ndef download():\n    name = input_name()\n    target = identity(name)\n    return send_file(BASE / target)\n',
  );
  put(
    "return.ts",
    'function inputUrl() {\n  return req.body.url\n}\nfunction identity(value: string) {\n  return value\n}\napp.get("/proxy", async (_req, res) => {\n  const value = inputUrl()\n  const target = identity(value)\n  res.send(await fetch(target))\n})\n',
  );
  put(
    "return.go",
    'func inputName(r *http.Request) string {\n return r.FormValue("name")\n}\nfunc identity(value string) string {\n return value\n}\nfunc download(r *http.Request) {\n name := inputName(r)\n target := identity(name)\n os.ReadFile(target)\n}\n',
  );

  expect(scan(root).map((f) => `${f.file}:${f.rule}`)).toEqual([
    "return.go:path-traversal",
    "return.py:path-traversal",
    "return.ts:ssrf",
  ]);
});

test("scan: 無害化して返す関数の戻り値は検出しない", () => {
  put(
    "safe-return.py",
    'def safe(value):\n    return secure_filename(value)\n\ndef download():\n    name = request.args["name"]\n    clean = safe(name)\n    return send_file(BASE / clean)\n',
  );
  put(
    "safe-return.ts",
    'function safe(value: string) {\n  return path.basename(value)\n}\napp.get("/file", (req, res) => {\n  const name = req.query.name\n  const clean = safe(name)\n  readFile(clean)\n})\n',
  );
  put(
    "safe-return.go",
    'func safe(value string) string {\n return filepath.Base(value)\n}\nfunc download(r *http.Request) {\n name := r.FormValue("name")\n clean := safe(name)\n os.ReadFile(clean)\n}\n',
  );

  expect(scan(root)).toEqual([]);
});

test("scan: JavaScriptの代表的なコールバック引数を追跡する", () => {
  put(
    "callback.ts",
    'app.post("/fetch", (req, res) => {\n  const urls = req.body.urls\n  urls.forEach((url) => {\n    fetch(url)\n  })\n})\n',
  );

  expect(
    scan(root).map((finding) => `${finding.file}:${finding.rule}`),
  ).toEqual(["callback.ts:ssrf"]);
});

test("scan: 同一モジュールのimportとGoパッケージ内の戻り値を追跡する", () => {
  put(
    "lib/input.ts",
    "export function inputUrl() {\n  return req.body.url\n}\n",
  );
  put(
    "main.ts",
    'import { inputUrl as loadUrl } from "./lib/input"\napp.get("/proxy", async (_req, res) => {\n  const target = loadUrl()\n  res.send(await fetch(target))\n})\n',
  );
  put("helpers.py", 'def input_name():\n    return request.args["name"]\n');
  put(
    "main.py",
    "from helpers import input_name as load_name\n\ndef download():\n    name = load_name()\n    return send_file(BASE / name)\n",
  );
  put(
    "go/input.go",
    'package api\nfunc inputName(r *http.Request) string {\n return r.FormValue("name")\n}\n',
  );
  put(
    "go/main.go",
    "package api\nfunc download(r *http.Request) {\n name := inputName(r)\n os.ReadFile(name)\n}\n",
  );

  expect(
    scan(root).map((finding) => `${finding.file}:${finding.rule}`),
  ).toEqual([
    "go/main.go:path-traversal",
    "main.py:path-traversal",
    "main.ts:ssrf",
  ]);
});

test("scan: sanitizerと別関数の変数はtaintとして引き継がない", () => {
  put(
    "safe.py",
    'def first():\n    value = request.args["name"]\n    safe = secure_filename(value)\n    return open(BASE / safe)\n\ndef second():\n    return open(BASE / value)\n',
  );
  put(
    "safe.ts",
    'app.get("/a", (req, res) => {\n const value = req.query.name\n const safe = path.basename(String(value))\n readFile(safe)\n})\napp.get("/inside", (req, res) => {\n const value = req.query.name\n const safe = inside(ROOT, value)\n readFile(safe)\n})\napp.get("/b", (_req, res) => {\n readFile(value)\n})\n',
  );
  put(
    "safe.go",
    'func first(r *http.Request) {\n value := r.FormValue("name")\n safe := filepath.Base(value)\n os.ReadFile(safe)\n}\nfunc second() {\n os.ReadFile(value)\n}\n',
  );

  expect(scan(root)).toEqual([]);
});

test("scanner coverage: 機械検出とAI判断の責務を一覧で固定する", () => {
  expect(MECHANICAL_COVERAGE).toContain(
    "入力値の代入・オブジェクトフィールド・if/else分岐から危険処理までの流れ",
  );
  expect(MECHANICAL_COVERAGE).toContain(
    "同一ファイル内の名前付き関数の引数・戻り値を経由するデータフロー",
  );
  expect(MECHANICAL_COVERAGE).toContain(
    "代表的なJavaScriptコールバックと同一モジュールimportを経由するデータフロー",
  );
  expect(AI_REQUIRED_COVERAGE).toContain(
    "利用者・テナント・所有者ごとの認可漏れ（IDORを含む）",
  );
  expect(AI_REQUIRED_COVERAGE).toContain(
    "動的コールバック・複数モジュール・DBをまたぐデータフロー",
  );
});

test("scan: 一部の分岐だけで安全化されても危険経路を残す", () => {
  put(
    "branch.py",
    'def download():\n    name = request.args["name"]\n    if trusted:\n        name = secure_filename(name)\n    return send_file(BASE / name)\n',
  );
  put(
    "branch.ts",
    'app.get("/file", (req, res) => {\n  let name = req.query.name\n  if (trusted) {\n    name = path.basename(String(name))\n  }\n  readFile(name)\n})\n',
  );
  put(
    "branch.go",
    'func download(r *http.Request) {\n name := r.FormValue("name")\n if trusted {\n  name = filepath.Base(name)\n }\n os.ReadFile(name)\n}\n',
  );

  expect(scan(root).map((f) => `${f.file}:${f.rule}`)).toEqual([
    "branch.go:path-traversal",
    "branch.py:path-traversal",
    "branch.ts:path-traversal",
  ]);
});

test("scan: ifとelseの全経路で安全化されれば検出しない", () => {
  put(
    "branch.py",
    'def download():\n    name = request.args["name"]\n    if windows:\n        name = secure_filename(name)\n    else:\n        name = basename(name)\n    return send_file(BASE / name)\n',
  );
  put(
    "branch.ts",
    'app.get("/file", (req, res) => {\n  let name = req.query.name\n  if (windows) {\n    name = path.basename(String(name))\n  } else {\n    name = safeJoin(ROOT, String(name))\n  }\n  readFile(name)\n})\n',
  );
  put(
    "branch.go",
    'func download(r *http.Request) {\n name := r.FormValue("name")\n if windows {\n  name = filepath.Base(name)\n } else {\n  name = resolveWithin(root, name)\n }\n os.ReadFile(name)\n}\n',
  );

  expect(scan(root)).toEqual([]);
});
