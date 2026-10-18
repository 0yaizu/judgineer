import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scan } from "../src/scanner";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scanner-composite-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(rel: string, body: string) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

test("scan: 複数の伝播経路と安全経路が混在しても検出結果を取り違えない", () => {
  put(
    "typescript/input.ts",
    [
      "export function requestedUrls() {",
      "  return req.body.urls",
      "}",
      "",
      "export function requestedPath() {",
      "  return req.query.path",
      "}",
      "",
    ].join("\n"),
  );
  put(
    "typescript/routes.ts",
    [
      'import { requestedPath, requestedUrls } from "./input"',
      "",
      'app.post("/preview", async (_req, res) => {',
      "  const state = { urls: requestedUrls() }",
      "  state.urls.forEach((url) => fetch(url))",
      "  res.sendStatus(204)",
      "})",
      "",
      'app.get("/file", (_req, res) => {',
      "  let path = requestedPath()",
      "  if (trusted) {",
      "    path = basename(String(path))",
      "  }",
      "  res.send(readFile(path))",
      "})",
      "",
    ].join("\n"),
  );
  put(
    "typescript/safe.ts",
    [
      'app.get("/safe", (req, res) => {',
      "  let path = req.query.path",
      "  if (windows) {",
      "    path = basename(String(path))",
      "  } else {",
      "    path = safeJoin(ROOT, String(path))",
      "  }",
      "  res.send(readFile(path))",
      "})",
      "",
    ].join("\n"),
  );

  put(
    "python/input.py",
    [
      "def requested_name():",
      '    return request.args["name"]',
      "",
      "def requested_target():",
      '    return request.form["target"]',
      "",
    ].join("\n"),
  );
  put(
    "python/routes.py",
    [
      "from .input import requested_name, requested_target",
      "",
      "def download():",
      "    state = {}",
      "    state.path = requested_name()",
      "    if internal_user:",
      "        state.path = secure_filename(state.path)",
      "    return send_file(BASE / state.path)",
      "",
      "def proxy():",
      "    target = requested_target()",
      "    return requests.get(target)",
      "",
    ].join("\n"),
  );
  put(
    "python/safe.py",
    [
      "def download():",
      '    name = request.args["name"]',
      "    if windows:",
      "        name = secure_filename(name)",
      "    else:",
      "        name = basename(name)",
      "    return send_file(BASE / name)",
      "",
    ].join("\n"),
  );

  put(
    "go/input.go",
    [
      "package api",
      "",
      "func requestedPath(r *http.Request) string {",
      '  return r.FormValue("path")',
      "}",
      "",
      "func requestedRedirect(r *http.Request) string {",
      '  return r.FormValue("next")',
      "}",
      "",
    ].join("\n"),
  );
  put(
    "go/routes.go",
    [
      "package api",
      "",
      "func download(w http.ResponseWriter, r *http.Request) {",
      "  var state State",
      "  state.Path = requestedPath(r)",
      "  if trusted {",
      "    state.Path = filepath.Base(state.Path)",
      "  }",
      "  data, _ := os.ReadFile(state.Path)",
      "  w.Write(data)",
      "}",
      "",
      "func forward(w http.ResponseWriter, r *http.Request) {",
      "  target := requestedRedirect(r)",
      "  http.Redirect(w, r, target, http.StatusFound)",
      "}",
      "",
    ].join("\n"),
  );
  put(
    "go/safe.go",
    [
      "package api",
      "",
      "func safeDownload(r *http.Request) {",
      '  path := r.FormValue("path")',
      "  if windows {",
      "    path = filepath.Base(path)",
      "  } else {",
      "    path = resolveWithin(root, path)",
      "  }",
      "  os.ReadFile(path)",
      "}",
      "",
    ].join("\n"),
  );

  const findings = scan(root);
  const actual = findings.map((finding) => `${finding.file}:${finding.rule}`);

  expect(actual).toEqual([
    "go/routes.go:path-traversal",
    "go/routes.go:open-redirect",
    "python/routes.py:path-traversal",
    "python/routes.py:ssrf",
    "typescript/routes.ts:ssrf",
    "typescript/routes.ts:path-traversal",
  ]);
  expect(findings.some((finding) => finding.file.endsWith("safe.ts"))).toBe(
    false,
  );
  expect(findings.some((finding) => finding.file.endsWith("safe.py"))).toBe(
    false,
  );
  expect(findings.some((finding) => finding.file.endsWith("safe.go"))).toBe(
    false,
  );
});
