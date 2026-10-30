// 発表用デモ (DEMO=1): 本物の AI の代わりに、clinic_results_api 向けの台本どおりに返す。
// 検査対象はスキャナが拾う3件 (SQL連結 / パス指定 / 認証なしの export) に対応する。
import type { ApplyResult } from "@tka/shared";
import type { z } from "zod";
import { type GenerateOpts, type generate, setAI } from "./ai/client";

/** 画面が空の入力欄で Enter を押すたびに入れる、若手(本人)のセリフ。1つ目の出来事用 */
export const DEMO_LINES = [
  "URLの患者IDを書き換えるだけで、他の人の検査結果が見られてしまっていると思います。",
  "認証が共通のAPIキーだけで、誰の結果かを確かめていません。しかもIDがSQLにそのまま入っているので、患者さんの個人情報が外から読み出されます。",
  "患者ごとのトークンで本人確認して、SQLはプレースホルダに直します。来月から3診療所が使うので、先に直します。",
  "患者向けアプリも、トークンを付けて呼ぶように直してもらいます。医事課にも連絡します。",
  "トークンを持っていない患者さんが見られなくならないか、診療時間外に確認してから入れ替えます。",
  "次は、患者の情報を返すAPIは、最初から「誰が誰の分を見ていいか」を確かめる作りにします。",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const senior = (text: string) => ({
  role: "senior" as const,
  name: "先輩",
  text,
});

// --- 出来事 (スキャナの rule → 出来事の番号) ---
const RULE_TO_ISSUE: Record<string, 1 | 2 | 3> = {
  "sql-string-build": 1,
  "path-traversal": 2,
  "route-without-auth": 3,
};
// 本文・会話・反映は、prompt に入っている incident_title のこの語句で出来事を見分ける
const MARKERS: [string, 1 | 2 | 3][] = [
  ["他人の検査結果", 1],
  ["見覚えのないファイル", 2],
  ["監査用の一覧", 3],
];
const whichIssue = (o: GenerateOpts<z.ZodType>): 1 | 2 | 3 => {
  const block = `${o.system}\n${o.prompt}`.match(
    /<(issue|incident)>([\s\S]*?)<\/\1>/,
  )?.[2];
  return MARKERS.find(([m]) => block?.includes(m))?.[1] ?? 1;
};

const ISSUES = {
  1: {
    day: 12,
    incident_title: "患者さんから「他人の検査結果が表示された」と連絡が来た",
    title: "他人の患者IDでも検査結果が見えてしまう",
    severity: "高" as const,
    nodes: ["patient_app", "api", "db"],
    ignored: {
      impact: "escalate" as const,
      reason: "閲覧が広がり、漏えいが公になる",
      after_days: 14,
      incident_title: "他の患者の結果の閲覧が相次いだ",
    },
  },
  2: {
    day: 45,
    incident_title: "結果票の取得に見覚えのないファイル名が並んでいた",
    title: "path指定で任意のファイルをダウンロードできる",
    severity: "高" as const,
    nodes: ["patient_app", "api", "docs"],
    ignored: {
      impact: "none" as const,
      reason: "",
      after_days: 0,
      incident_title: "",
    },
  },
  3: {
    day: 90,
    incident_title: "監査用の一覧が院外から取得されていた",
    title: "監査用の一覧(export)が認証なしで呼べる",
    severity: "高" as const,
    nodes: ["staff", "api", "db"],
    ignored: {
      impact: "none" as const,
      reason: "",
      after_days: 0,
      incident_title: "",
    },
  },
};

const DETAIL = {
  1: {
    incident_story:
      "朝8時すぎ、医事課に患者さんから電話が入った。アプリで見た検査結果が自分のものではなかった、という。医事課がログを確認すると、同じAPIキーでたくさんの患者IDが照会されていた。",
    signals: [
      [
        "08:42:10",
        "医事課から",
        "warn",
        "「自分のものではない患者IDでも検査結果が表示された、と患者さんから連絡がありました」",
      ],
      [
        "08:55:31",
        "api.log",
        "info",
        "GET /api/patients/P0102/results 200 (X-API-Key 共通キー)",
      ],
      [
        "08:55:33",
        "api.log",
        "info",
        "GET /api/patients/P0103/results 200 (X-API-Key 共通キー)",
      ],
      [
        "08:55:34",
        "api.log",
        "info",
        "GET /api/patients/P0104/results 200 (X-API-Key 共通キー)",
      ],
      [
        "09:03:12",
        "監視",
        "warn",
        "同じAPIキーから1分間に120件の患者IDが照会された",
      ],
    ],
    what_happens:
      "患者アプリは全員で同じAPIキーを使い、見たい患者IDをURLで指定している。APIは「キーが正しいか」しか見ておらず、誰の結果を見てよいかを確かめない。IDはSQLにもそのまま入るため、細工した値で他の患者の情報まで引き出される。",
    who_is_affected: "通院患者(氏名・診断名・検査結果)と、診療所の医事課",
    background_link: "患者は自分の情報だけ閲覧できる必要がある",
  },
  2: {
    incident_story:
      "月末の点検で、結果票ダウンロードのログに結果票とは思えないファイル名の要求が並んでいるのを、システム担当が見つけた。",
    signals: [
      [
        "10:14:02",
        "医事課から",
        "warn",
        "「結果票のダウンロードが、いつもと違う動きをしていないか見てほしい」",
      ],
      [
        "10:20:45",
        "api.log",
        "info",
        "GET /api/documents/download?path=/srv/clinic/documents/r_0041.pdf 200",
      ],
      [
        "10:20:51",
        "api.log",
        "warn",
        "GET /api/documents/download?path=../.env 200",
      ],
      [
        "10:21:03",
        "api.log",
        "warn",
        "GET /api/documents/download?path=/etc/hostname 200",
      ],
    ],
    what_happens:
      "ダウンロードのAPIは、渡されたpathをそのままファイルとして返す。保管領域の外のファイルも返るので、サーバーの設定やAPIキーを含むファイルまで取り出される。",
    who_is_affected: "通院患者の結果票と、診療所のシステム全体",
    background_link: "結果票PDFは文書保管領域から配信している",
  },
  3: {
    incident_story:
      "夜間の監視で、院外のIPから監査用の一覧が丸ごと取得されているのが見つかった。",
    signals: [
      [
        "02:31:18",
        "監視",
        "error",
        "院外IP 203.0.113.7 から /api/admin/export が呼ばれた",
      ],
      [
        "02:31:19",
        "api.log",
        "info",
        "GET /api/admin/export 200 (キーなし) 応答サイズ 4.2MB",
      ],
      [
        "07:50:00",
        "医事課から",
        "warn",
        "「監査用の一覧は医事課の端末でしか使わない想定です」",
      ],
    ],
    what_happens:
      "監査用の一覧を出すAPIには認証がない。URLを知っていれば誰でも、氏名・メール・電話・生年月日・診断名の全件を含むCSVを受け取れる。",
    who_is_affected: "全ての通院患者と、診療所の信用",
    background_link: "扱うデータに氏名・診断名などの個人情報を含む",
  },
} as const;

const ARCH = {
  nodes: [
    { id: "patient_app", label: "患者向けアプリ", kind: "external" as const },
    { id: "api", label: "検査結果API", kind: "internal" as const },
    { id: "db", label: "院内DB", kind: "db" as const },
    { id: "docs", label: "文書保管領域", kind: "db" as const },
    { id: "staff", label: "医事課", kind: "person" as const },
  ],
  edges: [
    {
      from: "patient_app",
      to: "api",
      label: "共通APIキーで結果を照会",
      direction: "both" as const,
      kind: "runtime" as const,
    },
    {
      from: "api",
      to: "db",
      label: "検査結果を検索",
      direction: "both" as const,
      kind: "runtime" as const,
    },
    {
      from: "api",
      to: "docs",
      label: "結果票PDFを読む",
      direction: "one" as const,
      kind: "runtime" as const,
    },
    {
      from: "staff",
      to: "api",
      label: "監査用の一覧を取得",
      direction: "both" as const,
      kind: "ops" as const,
    },
  ],
};

// --- apply: app.py の該当行を、prompt の source (行番号つき) から探して直す ---
function appPyLines(system: string): string[] {
  const chunk = system.match(/### app\.py\n([\s\S]*)/)?.[1] ?? "";
  const lines: string[] = [];
  for (const l of chunk.split("\n")) {
    const m = l.match(/^ *\d+ {2}(.*)$/);
    if (!m) break;
    lines.push(m[1] as string);
  }
  return lines;
}

function codeChanges(
  n: 1 | 2 | 3,
  system: string,
): ApplyResult["code_changes"] {
  const src = appPyLines(system);
  // 1始まりの行番号。見つからなければ 0 (その変更は捨てる)
  const at = (pred: (l: string) => boolean, from = 0) => {
    const i = src.findIndex((l, k) => k >= from - 1 && pred(l));
    return i < 0 ? 0 : i + 1;
  };
  const changes: ApplyResult["code_changes"] = [];
  const put = (
    start: number,
    end: number,
    new_lines: string[],
    note: string,
  ) => {
    if (start > 0)
      changes.push({
        file: "app.py",
        start_line: start,
        end_line: end,
        new_lines,
        note,
      });
  };
  if (n === 1) {
    const route = at((l) => l.includes('"/api/patients/<patient_id>/results"'));
    const auth = at((l) => l.includes("if not check_key():"), route);
    const sql = at((l) => l.includes('f"SELECT patient_id'), route);
    if (route) {
      put(
        route,
        route - 1,
        [
          "def check_patient_token(patient_id):",
          '    """患者ごとに発行したトークンが、URLの患者IDのものか確かめる"""',
          '    token = request.headers.get("X-Patient-Token", "")',
          "    with get_db() as db:",
          "        row = db.execute(",
          '            "SELECT 1 FROM patient_tokens WHERE patient_id = ? AND token = ?",',
          "            (patient_id, token),",
          "        ).fetchone()",
          "    return row is not None",
          "",
          "",
        ],
        "患者ごとのトークンで本人確認する関数を足した",
      );
    }
    put(
      auth,
      auth + 1,
      [
        "    if not check_patient_token(patient_id):",
        '        return jsonify({"error": "unauthorized"}), 401',
      ],
      "共通キーの確認を、本人のトークンの確認に置き換えた",
    );
    if (sql) {
      put(
        sql - 1,
        sql + 1,
        [
          "        rows = db.execute(",
          '            "SELECT patient_id, diagnosis, result, tested_at FROM test_results WHERE patient_id = ?",',
          "            (patient_id,),",
          "        ).fetchall()",
        ],
        "SQLをプレースホルダにした",
      );
    }
  } else if (n === 2) {
    const dbPath = at((l) => l.startsWith("DB_PATH ="));
    const send = at((l) => l.includes("send_file(request.args.get"));
    if (dbPath)
      put(
        dbPath + 1,
        dbPath,
        ['DOCS_DIR = (DB_PATH.parent / "documents").resolve()'],
        "ダウンロードできる置き場所を決めた",
      );
    if (send) {
      put(
        send,
        send,
        [
          '    name = Path(request.args.get("path", "")).name',
          "    target = (DOCS_DIR / name).resolve()",
          "    if DOCS_DIR not in target.parents:",
          '        return jsonify({"error": "not found"}), 404',
          "    return send_file(target)",
        ],
        "保管領域の中のファイルだけ返すようにした",
      );
    }
  } else {
    const doc = at((l) => l.includes("医事課が監査用の一覧を出力する"));
    if (doc)
      put(
        doc + 1,
        doc,
        [
          "    if not secrets.compare_digest(",
          '        request.headers.get("X-Admin-Key", ""), os.environ["ADMIN_EXPORT_KEY"]',
          "    ):",
          '        return jsonify({"error": "unauthorized"}), 401',
        ],
        "医事課用の鍵がなければ返さないようにした",
      );
  }
  return changes;
}

function apply(o: GenerateOpts<z.ZodType>): ApplyResult {
  const n = whichIssue(o);
  const withToken = n === 1;
  return {
    summary: {
      1: "患者ごとのトークンで本人確認し、SQLをプレースホルダにした",
      2: "ダウンロードを文書保管領域の中のファイルだけに限った",
      3: "監査用の一覧に医事課用の鍵の確認を足した",
    }[n],
    code_changes: codeChanges(n, o.system),
    architecture_after: withToken
      ? {
          nodes: [
            ...ARCH.nodes,
            { id: "token", label: "患者ごとの本人確認", kind: "internal" },
          ],
          edges: [
            ...ARCH.edges,
            {
              from: "token",
              to: "api",
              label: "URLの患者IDと照合",
              direction: "one",
              kind: "runtime",
            },
          ],
        }
      : ARCH,
    arch_notes: withToken ? ["患者ごとの本人確認を足した"] : [],
    future: [],
    new_incidents: [],
    reflection: {
      1: "入れたよ。他の人のIDでは見えなくなって、SQLの穴もふさがった。ただ、患者向けアプリ側はまだ共通キーで呼んでるよね。入れ替えるとき、何を気にする？",
      2: "入れたよ。保管領域の外は返さなくなった。ただ、誰の結果票かの確認はこの修正ではまだ入ってない。次に何を見ておく？",
      3: "入れたよ。鍵がなければ一覧は返らない。ただ、鍵を医事課にどう渡すかが残ってるね。どうする？",
    }[n],
  };
}

// --- chat: 若手の発言が DEMO_LINES の何番目かで返す ---
function chat(o: GenerateOpts<z.ZodType>) {
  const said =
    [...o.prompt.matchAll(/若手（本人）: (.*)/g)].at(-1)?.[1]?.trim() ?? "";
  const phase = o.prompt.match(/いまの段階: (\w+)/)?.[1] ?? "investigate";
  const first = whichIssue(o) === 1;
  if (o.prompt.includes("<hint>")) {
    return {
      messages: [
        senior(
          first
            ? "手がかりは3つ。①ログの患者IDが毎回違うこと ②app.py の44行目、何を確かめているか ③48行目、IDがどこに入っているか。どれから考える？"
            : "手がかりは3つ。①ログの要求の中身 ②コードの該当行 ③背景にある「患者は自分の情報だけ」という条件。どれから考える？",
        ),
      ],
      phase,
    };
  }
  const i = DEMO_LINES.indexOf(said);
  switch (i) {
    case 0:
      return {
        messages: [
          senior(
            first
              ? "ログの患者IDは毎回違うね。app.py の44行目、APIキーで確かめているのは何だろう？"
              : "左のログとコードを見て、根拠になっているのはどの行だと思う？",
          ),
        ],
        phase: "investigate",
      };
    case 1:
      return {
        messages: [
          {
            role: "stakeholder" as const,
            name: "医事課 担当",
            text: "本当に他の患者さんの結果が見えているなら、すぐ止めたいです。ただ、アプリは診療時間中ずっと使われていて、止めると予約患者への連絡に影響します。",
          },
          senior(
            "原因と、誰に何が起きるかはつかめてるね。じゃあ、どう対応する？",
          ),
        ],
        phase: "decide",
      };
    case 2:
      return {
        messages: [
          senior("その方針で直してみようか。下の確認を押せば反映するよ。"),
        ],
        phase: "ready",
        plan: said,
        reason:
          "個人情報の漏えいを止め、来月から使う3診療所でも同じ問題を起こさないため",
      };
    case 3:
      return {
        messages: [
          senior(
            "連絡は大事だね。入れ替えるとき、古いやり方のままのアプリが残っていたらどうなる？",
          ),
        ],
        phase: "reflect",
      };
    case 4:
      return {
        messages: [
          senior(
            "その確認があれば安心だね。最後に、次にアプリを作るとき、最初から気をつけたいことは？",
          ),
        ],
        phase: "reflect",
      };
    case 5:
      return {
        messages: [
          senior("それを最初に決めておけば、今回の件は防げたね。お疲れさま。"),
        ],
        phase: "done",
        lesson: said,
      };
  }
  // 台本にない発言: 段階に合わせて一つ進める
  if (phase === "decide")
    return {
      messages: [
        senior("その方針で直してみようか。下の確認を押せば反映するよ。"),
      ],
      phase: "ready",
      plan: said || "方針どおりに直す",
      reason: "運用への影響を抑えるため",
    };
  if (phase === "reflect")
    return {
      messages: [senior("いいね。それを次に活かそう。")],
      phase: "done",
      lesson: said,
    };
  return {
    messages: [senior("どこにそう書いてある？根拠の行を教えて。")],
    phase,
  };
}

function reply(o: GenerateOpts<z.ZodType>): unknown {
  switch (o.task) {
    case "arch":
      return { architecture: ARCH };
    case "extra_findings":
      return { candidates: [] };
    case "flows_all":
      return {
        flows: [
          {
            actor: "patient_app",
            title: "患者が検査結果を確認する",
            per_day: 300,
            feature_ids: ["f1"],
            steps: [
              { from: "patient_app", to: "api", label: "患者IDで照会" },
              { from: "api", to: "db", label: "検査結果を検索" },
            ],
          },
          {
            actor: "patient_app",
            title: "患者が結果票をダウンロードする",
            per_day: 80,
            feature_ids: ["f2"],
            steps: [
              { from: "patient_app", to: "api", label: "結果票を要求" },
              { from: "api", to: "docs", label: "PDFを読む" },
            ],
          },
          {
            actor: "staff",
            title: "医事課が監査用の一覧を出力する",
            per_day: 2,
            feature_ids: ["f3"],
            steps: [
              { from: "staff", to: "api", label: "一覧を取得" },
              { from: "api", to: "db", label: "全件を検索" },
            ],
          },
        ],
        assumed_users: 800,
      };
    case "flows":
      return { flows: [] };
    case "issues":
    case "issues_missing": {
      const found = JSON.parse(
        o.prompt.match(/<findings>\n([\s\S]*?)\n<\/findings>/)?.[1] ?? "[]",
      ) as { id: string; rule: string }[];
      const issues = [];
      const dismissed = [];
      for (const f of found) {
        const n = RULE_TO_ISSUE[f.rule];
        if (!n) {
          dismissed.push({
            finding_id: f.id,
            reason: "デモの題材では実害にならない",
          });
          continue;
        }
        const d = ISSUES[n];
        issues.push({
          finding_ids: [f.id],
          day: d.day,
          incident_title: d.incident_title,
          view: "code" as const,
          affected_nodes: [...d.nodes],
          title: d.title,
          category: "脆弱性" as const,
          severity: d.severity,
          if_ignored: d.ignored,
        });
      }
      return { issues, dismissed };
    }
    case "detail": {
      const d = DETAIL[whichIssue(o)];
      return {
        ...d,
        signals: d.signals.map(([time, source, level, text]) => ({
          time,
          source,
          level,
          text,
        })),
      };
    }
    case "chat":
      return chat(o);
    case "apply":
      return apply(o);
    case "attack_scenarios":
      return {
        scenarios: [
          {
            title: "患者IDを順に変えて照会する",
            path: "/api/patients/<id>/results のIDを連番で変える",
            target: "通院患者の検査結果",
            preconditions: "共通APIキーを知っている(アプリから取り出せる)",
            detectable_signs: "同じキーから別々の患者IDへの照会が続く",
          },
        ],
      };
    default:
      throw new Error(`unexpected task ${o.task}`);
  }
}

/** 2〜4秒待ってから台本どおりに返す (テストでは待たない)。戻り値は schema を通す */
export async function demoAI(o: GenerateOpts<z.ZodType>) {
  if (process.env.NODE_ENV !== "test") await sleep(2000 + Math.random() * 2000);
  return o.schema.parse(reply(o));
}

if (process.env.DEMO === "1") setAI(demoAI as unknown as typeof generate);
