import type { DiffRow } from "@tka/shared";

// サンプルアプリ用の修正。どの案を選んでも、ルールごとに同じ修正を反映する
type Edit = { find: string; replace?: string; insertAfter?: string[] };

type Patch = { edits: Edit[]; needsOs?: boolean };

const PATCHES: Record<string, Patch> = {
  "cors-wildcard": {
    edits: [
      {
        find: 'CORS(app, origins="*")',
        replace: 'CORS(app, origins=["https://partner-b.example.jp"])',
      },
    ],
  },
  "hardcoded-secret": {
    edits: [
      {
        find: 'PARTNER_API_KEY = "a-company-partner-2024"',
        replace: 'PARTNER_API_KEY = os.environ["PARTNER_API_KEY"]',
      },
    ],
    needsOs: true,
  },
  "sql-string-build": {
    edits: [
      {
        find: "f\"SELECT customer_id, item, price, purchased_at FROM purchases WHERE date(purchased_at) = '{date}'\"",
        replace:
          '"SELECT customer_id, item, price, purchased_at FROM purchases WHERE date(purchased_at) = ?", (date,)',
      },
      {
        find: 'LIKE \'%" + name + "%\'"',
        replace: 'LIKE ?", ("%" + name + "%",)',
      },
    ],
  },
  "select-all-columns": {
    edits: [
      {
        find: "SELECT * FROM customers WHERE name",
        replace: "SELECT id, name, email FROM customers WHERE name",
      },
    ],
  },
  "pii-in-logs": {
    edits: [
      {
        find: 'logger.info("customer hit: %s %s %s", r["name"], r["email"], r["phone"])',
        replace: 'logger.info("customer hit: id=%s", r["id"])',
      },
    ],
  },
  "route-without-auth": {
    edits: [
      {
        find: '"""月末の突き合わせ用。社内から手動で呼ぶ想定"""',
        insertAfter: [
          "    if not check_key():",
          '        return jsonify({"error": "unauthorized"}), 401',
        ],
      },
    ],
  },
  "debug-enabled": {
    edits: [
      { find: "debug=True", replace: 'debug=os.getenv("FLASK_DEBUG") == "1"' },
    ],
    needsOs: true,
  },
};

// 選んだ案によって、先の出来事が起きなくなる組み合わせ（サンプルの台本）
export const PREVENTS: Record<
  string,
  { option_index: number; rule: string; reason: string }[]
> = {
  "select-all-columns": [
    {
      option_index: 1,
      rule: "route-without-auth",
      reason:
        "社内用APIを作り直すときに認証つきで作るので、認証なしの /api/export は残らない。",
    },
  ],
};

export function applyPatch(code: string, rule: string): string {
  const patch = PATCHES[rule];
  if (!patch) return code;
  const lines = code.split("\n");
  for (const edit of patch.edits) {
    const i = lines.findIndex((l) => l.includes(edit.find));
    if (i < 0) continue;
    if (edit.insertAfter) lines.splice(i + 1, 0, ...edit.insertAfter);
    else lines[i] = lines[i].replace(edit.find, () => edit.replace ?? "");
  }
  if (patch.needsOs && !lines.includes("import os")) {
    const i = lines.indexOf("import logging");
    if (i >= 0) lines.splice(i + 1, 0, "import os");
  }
  return lines.join("\n");
}

type Op = {
  type: "ctx" | "del" | "add";
  old: number | null;
  new: number | null;
  text: string;
};

const CONTEXT = 3;

// 行単位の差分（LCS）。前後の文脈つきで、変更のかたまりごとに区切る
export function diffRows(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ type: "ctx", old: i + 1, new: j + 1, text: a[i] });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])
    ) {
      ops.push({ type: "add", old: null, new: j + 1, text: b[j] });
      j++;
    } else {
      ops.push({ type: "del", old: i + 1, new: null, text: a[i] });
      i++;
    }
  }

  const keep = ops.map((o, n) =>
    o.type !== "ctx"
      ? true
      : ops
          .slice(Math.max(0, n - CONTEXT), n + CONTEXT + 1)
          .some((x) => x.type !== "ctx"),
  );
  const rows: DiffRow[] = [];
  ops.forEach((o, n) => {
    if (!keep[n]) return;
    if (n === 0 || !keep[n - 1])
      rows.push({ type: "hunk", text: `${o.old ?? o.new}行目あたり` });
    rows.push(o);
  });
  return rows;
}
