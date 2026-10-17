import type { NODE_KINDS } from "@tka/shared";

type NodeKind = (typeof NODE_KINDS)[number];

export type GoldenFinding = {
  rule: string;
  /** 目印。by が "line"(既定) なら finding の行の文字列、"title" なら title に含まれる */
  match: string;
  by?: "line" | "title";
  /** issue = dismissed にしてはいけない / either = どちらでもよい */
  expect: "issue" | "either";
  min_severity?: "低" | "中" | "高";
  note: string;
};

/** 意図して入れた欠陥のうち、スキャナのルールが拾わないもの */
export type KnownGap = {
  /** 欠陥のある行に含まれる文字列。題材から消えたらテストが気づく */
  match: string;
  file: string;
  title: string;
  note: string;
};

export type Golden = {
  findings: GoldenFinding[];
  known_gaps?: KnownGap[];
  arch: { kinds: NodeKind[] };
  /** 本文に書いてはいけない原因の名前 (原因は読み手が推理するもの) */
  cause_words: string[];
};

export const aCompanyApi: Golden = {
  findings: [
    {
      rule: "cors-wildcard",
      match: 'origins="*"',
      expect: "either",
      note: "API キー必須のサーバー間 API なので、ブラウザ向けの CORS は実害が小さい。本物とも誤検知とも言える",
    },
    {
      rule: "hardcoded-secret",
      match: "PARTNER_API_KEY = ",
      expect: "issue",
      min_severity: "中",
      note: "全提携先で共通の本物のキーがコードに入っている",
    },
    {
      rule: "relative-path",
      match: 'DB_PATH = "customers.db"',
      expect: "issue",
      min_severity: "低",
      note: "起動する場所が変わると別の(空の)DB を作ってしまう。影響は運用の手違いに限られる",
    },
    {
      rule: "sql-string-build",
      match: "{date}",
      expect: "issue",
      min_severity: "高",
      note: "クエリ文字列の date をそのまま SQL に埋め込んでいる (キー保持者から DB 全体が抜ける)",
    },
    {
      rule: "sql-string-build",
      match: '%" + name',
      expect: "issue",
      min_severity: "高",
      note: "検索語を SQL に連結していて、個人情報の表を丸ごと読まれうる",
    },
    {
      rule: "select-all-columns",
      match: "SELECT * FROM customers WHERE name LIKE",
      expect: "either",
      note: "全列取得は事実だが、検索結果を返す用途なので設計の好みの範囲",
    },
    {
      rule: "pii-in-logs",
      match: 'r["email"]',
      expect: "issue",
      min_severity: "中",
      note: "検索のたびにメール・電話番号がログに残る",
    },
    {
      rule: "select-all-columns",
      match: 'SELECT * FROM customers"',
      expect: "either",
      note: "export は全件返す役目なので全列取得自体は自然。認証が無いほうが本題",
    },
    {
      rule: "debug-enabled",
      match: "debug=True",
      expect: "issue",
      min_severity: "高",
      note: "0.0.0.0 で待ち受けたままデバッグモードで公開している",
    },
    {
      rule: "route-without-auth",
      match: "/api/export",
      by: "title",
      expect: "issue",
      min_severity: "高",
      note: "認証なしで顧客の全件が取れる",
    },
  ],
  known_gaps: [
    {
      match: "conn = sqlite3.connect(DB_PATH)",
      file: "app.py",
      title: "DB 接続を閉じていない",
      note: "リクエストのたびに接続が残り、長く動かすとファイル記述子が尽きる",
    },
    {
      match: 'date = request.args.get("date")',
      file: "app.py",
      title: "date 未指定を許している",
      note: "未指定だと 'None' で検索して空を返し、B社のバッチが失敗に気づけない",
    },
    {
      match: 'return jsonify({"deleted": customer_id})',
      file: "app.py",
      title: "存在しない顧客の削除でも成功を返す",
      note: "退会処理が空振りしても成功に見え、気づけない",
    },
    {
      match: 'request.headers.get("X-API-Key") == PARTNER_API_KEY',
      file: "app.py",
      title: "API キーを == で比較している",
      note: "比較にかかる時間の差からキーを推測される(タイミング攻撃)",
    },
    {
      match: "flask-cors==4.0.1",
      file: "requirements.txt",
      title: "既知の脆弱性がある版に固定している",
      note: "ここでは確かめられない。flask 3.0.3 と flask-cors 4.0.1 に公開済みの脆弱性がある(PyPI の脆弱性情報で確認済み)",
    },
  ],
  arch: { kinds: ["internal", "db", "partner"] },
  cause_words: [
    "SQLインジェクション",
    "インジェクション",
    "ハードコード",
    "CORS",
    "デバッグモード",
  ],
};
