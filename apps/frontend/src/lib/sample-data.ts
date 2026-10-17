// バックエンドなしで動かすため、サンプルアプリ1本分の台本をそのまま持たせている。
import type {
  Architecture,
  Background,
  Finding,
  IncidentText,
  RuleText,
} from "@tka/shared";

export const SAMPLE_BACKGROUND: Background = {
  title: "A社 顧客データ提供API",
  stakeholders:
    "A社（データを持っている会社。自分たちはA社の開発チーム）、B社（提携先。A社のデータを使っておすすめ表示をしている）",
  data_flow:
    "A社のDB → このAPI → B社のバッチが毎朝6時に前日分を取得。B社のサポート窓口も顧客検索に使っている",
  data_types: "氏名、メールアドレス、電話番号、購買履歴（個人情報を含む）",
  constraints:
    "B社との契約で、毎朝7時までにデータを渡すことになっている。止めると違約金が発生する。B社の売上の約3割がこの連携に依存している",
  team: "A社の開発チームは2人。うち1人は来月から別プロジェクトに移る",
  notes: "B社以外にも、来年から別の提携先C社が同じAPIを使う予定",
};

export const SAMPLE_CODE: string =
  '"""\nA社 顧客データ提供API（デモ用サンプル）\n\nA社が持つ顧客の購買データを、提携先のB社に毎日提供するためのAPI。\nB社はこのデータを使って、自社サービスのおすすめ表示を行っている。\n\n※ 学習用に、運用で問題になりやすい書き方をわざと含めています。実運用では使わないでください。\n"""\nimport logging\nimport sqlite3\n\nfrom flask import Flask, jsonify, request\nfrom flask_cors import CORS\n\napp = Flask(__name__)\nCORS(app, origins="*")\n\nlogging.basicConfig(level=logging.INFO)\nlogger = logging.getLogger("a-company-api")\n\n# B社に渡しているAPIキー（全提携先で共通）\nPARTNER_API_KEY = "a-company-partner-2024"\nDB_PATH = "customers.db"\n\n\ndef get_db():\n    conn = sqlite3.connect(DB_PATH)\n    conn.row_factory = sqlite3.Row\n    return conn\n\n\ndef check_key():\n    return request.headers.get("X-API-Key") == PARTNER_API_KEY\n\n\n@app.route("/api/purchases")\ndef purchases():\n    """B社が毎朝呼ぶ、前日分の購買データ"""\n    if not check_key():\n        return jsonify({"error": "unauthorized"}), 401\n    date = request.args.get("date")\n    db = get_db()\n    rows = db.execute(\n        f"SELECT customer_id, item, price, purchased_at FROM purchases WHERE date(purchased_at) = \'{date}\'"\n    ).fetchall()\n    logger.info("purchases requested date=%s count=%d", date, len(rows))\n    return jsonify([dict(r) for r in rows])\n\n\n@app.route("/api/customers/search")\ndef search_customers():\n    """B社のサポート窓口が、問い合わせ対応で顧客を探すときに使う"""\n    if not check_key():\n        return jsonify({"error": "unauthorized"}), 401\n    name = request.args.get("name", "")\n    db = get_db()\n    rows = db.execute(\n        "SELECT * FROM customers WHERE name LIKE \'%" + name + "%\'"\n    ).fetchall()\n    for r in rows:\n        logger.info("customer hit: %s %s %s", r["name"], r["email"], r["phone"])\n    return jsonify([dict(r) for r in rows])\n\n\n@app.route("/api/export")\ndef export_all():\n    """月末の突き合わせ用。社内から手動で呼ぶ想定"""\n    db = get_db()\n    rows = db.execute("SELECT * FROM customers").fetchall()\n    return jsonify([dict(r) for r in rows])\n\n\n@app.route("/api/customers/<int:customer_id>", methods=["DELETE"])\ndef delete_customer(customer_id):\n    """退会処理"""\n    if not check_key():\n        return jsonify({"error": "unauthorized"}), 401\n    db = get_db()\n    db.execute("DELETE FROM customers WHERE id = ?", (customer_id,))\n    db.commit()\n    return jsonify({"deleted": customer_id})\n\n\nif __name__ == "__main__":\n    app.run(host="0.0.0.0", port=5001, debug=True)\n';

export const SAMPLE_ARCH: Architecture = {
  nodes: [
    { id: "a_db", label: "A社 顧客DB", kind: "db" },
    { id: "api", label: "顧客データ提供API", kind: "internal" },
    { id: "a_staff", label: "A社 社内担当", kind: "person" },
    { id: "b_batch", label: "B社 夜間バッチ", kind: "partner" },
    { id: "b_support", label: "B社 サポート窓口", kind: "partner" },
    { id: "outsider", label: "外部の第三者", kind: "external" },
  ],
  edges: [
    {
      from: "a_db",
      to: "api",
      label: "顧客・購買データ",
      direction: "one",
      kind: "runtime",
    },
    {
      from: "api",
      to: "b_batch",
      label: "毎朝6時 前日分を取得",
      direction: "one",
      kind: "runtime",
    },
    {
      from: "api",
      to: "b_support",
      label: "顧客検索",
      direction: "one",
      kind: "runtime",
    },
    {
      from: "api",
      to: "a_staff",
      label: "月末 全件書き出し",
      direction: "one",
      kind: "ops",
    },
    {
      from: "outsider",
      to: "api",
      label: "インターネット経由",
      direction: "one",
      kind: "runtime",
    },
  ],
};

export const SAMPLE_FINDINGS: Finding[] = [
  {
    id: "F1",
    rule: "cors-wildcard",
    title: "どのサイトからでもAPIを呼べる設定（CORS *）",
    file: "app.py",
    line: 16,
  },
  {
    id: "F2",
    rule: "hardcoded-secret",
    title: "APIキーやパスワードをコードに直接書いている",
    file: "app.py",
    line: 22,
  },
  {
    id: "F3",
    rule: "sql-string-build",
    title: "SQLを文字列の連結で組み立てている",
    file: "app.py",
    line: 44,
  },
  {
    id: "F4",
    rule: "sql-string-build",
    title: "SQLを文字列の連結で組み立てている",
    file: "app.py",
    line: 58,
  },
  {
    id: "F5",
    rule: "select-all-columns",
    title: "全カラム（SELECT *）をそのまま返している",
    file: "app.py",
    line: 58,
  },
  {
    id: "F6",
    rule: "pii-in-logs",
    title: "ログに個人情報を書き出している",
    file: "app.py",
    line: 61,
  },
  {
    id: "F7",
    rule: "select-all-columns",
    title: "全カラム（SELECT *）をそのまま返している",
    file: "app.py",
    line: 69,
  },
  {
    id: "F8",
    rule: "debug-enabled",
    title: "デバッグモードのまま公開している",
    file: "app.py",
    line: 85,
  },
  {
    id: "F9",
    rule: "route-without-auth",
    title: "認証なしで呼べるAPI（/api/export）",
    file: "app.py",
    line: 65,
  },
];

export const RULES: Record<string, RuleText> = {
  "sql-string-build": {
    title: "外から渡した文字列でSQLを書き換えられる",
    category: "脆弱性",
    severity: "高",
    what_happens:
      "検索欄や日付パラメータに細工した文字列を入れると、SQLの意味が変わり、DBの中身を丸ごと読まれたり消されたりする。APIキーを持っている相手や、そのキーが漏れた先からも実行できる。",
    who: "A社（顧客データの漏洩・消失）、B社（受け取るデータが壊れる）、顧客",
    options: [
      {
        label: "プレースホルダに書き換える",
        change_summary:
          "SQLに値を埋め込むのをやめ、? で値を渡す形に2か所とも書き換える。",
        effects: {
          security:
            "SQLの書き換えはできなくなる。キーが漏れた場合の他の悪用は残る。",
          effort: "数行の修正で済む。テストを含めて半日程度。",
          stakeholders: "B社側の変更は不要。返すデータの形も変わらない。",
          operations:
            "同じ書き方が今後混ざらないよう、レビューで確認する必要がある。",
        },
      },
      {
        label: "書き換え＋入力チェック",
        change_summary:
          "プレースホルダに書き換えたうえで、date は日付形式、name は文字数と使える文字を制限する。",
        effects: {
          security: "SQLの書き換えに加えて、想定外の入力も入口で弾ける。",
          effort: "1日程度。どこまで制限するかを決める必要がある。",
          stakeholders:
            "B社のサポート窓口が記号を含む名前で検索している場合、検索できなくなる可能性がある。",
          operations:
            "弾いた入力をログに残すと、攻撃の兆候に気づきやすくなる。",
        },
      },
      {
        label: "検索APIを止めてから直す",
        change_summary:
          "修正が終わるまで /api/customers/search を無効にし、購買データのAPIだけ動かす。",
        effects: {
          security:
            "修正までの間、検索APIからの攻撃はなくなる。購買データのAPIの問題は残る。",
          effort: "止めるのはすぐできる。修正自体は別途必要。",
          stakeholders:
            "B社のサポート窓口が顧客を検索できなくなる。事前の連絡が必要。",
          operations: "いつ再開するかを決めて、B社と共有しておく必要がある。",
        },
      },
    ],
    unknowns: [
      "B社のサポート窓口が1日に何回検索を使っているか",
      "これまでに不審なリクエストが来ていないか（ログの確認状況）",
    ],
  },
  "hardcoded-secret": {
    title: "提携先と共通のAPIキーがコードに書かれている",
    category: "脆弱性",
    severity: "高",
    what_happens:
      "コードを見られる人なら誰でもキーを知ることができ、リポジトリの共有や流出でキーが漏れる。全提携先で同じキーのため、漏れたときにどこから漏れたのか追えず、止めると全提携先が一斉に止まる。",
    who: "A社、B社、来年から加わるC社",
    options: [
      {
        label: "環境変数に移す",
        change_summary:
          "キーをコードから消し、サーバーの環境変数から読む。キーの値はそのまま。",
        effects: {
          security:
            "コードからの漏洩は防げる。すでにコードを見た人はキーを知っている状態のまま。",
          effort: "数行の修正とサーバー設定。1〜2時間。",
          stakeholders: "B社の変更は不要。",
          operations:
            "キーの置き場所をチーム内で引き継ぐ必要がある（来月抜けるメンバーがいる）。",
        },
      },
      {
        label: "提携先ごとにキーを分ける",
        change_summary:
          "B社用・C社用に別のキーを発行し、どの会社からのアクセスかを記録できるようにする。古いキーは期限を決めて無効化する。",
        effects: {
          security: "漏れたときに相手を特定でき、その会社だけ止められる。",
          effort: "キーの管理の仕組みが必要。2〜3日。",
          stakeholders:
            "B社にキーの差し替えをお願いする必要がある。C社の接続前に入れておける。",
          operations:
            "キーの発行・無効化の手順を決め、2人のチームで回せるようにする必要がある。",
        },
      },
      {
        label: "今すぐキーを変える",
        change_summary:
          "すでに漏れている前提で、今日中にキーを新しくし、B社に新しいキーを渡す。",
        effects: {
          security: "今のキーが漏れていても、それ以降は使えなくなる。",
          effort: "作業自体は短い。B社との調整が中心。",
          stakeholders:
            "B社が翌朝6時までにキーを差し替えないと、7時の受け渡しに間に合わず契約違反になる。",
          operations:
            "差し替えのタイミングをB社と合わせ、失敗したときの戻し方も決めておく必要がある。",
        },
      },
    ],
    unknowns: [
      "このリポジトリをどこまでの人が見られるか",
      "B社側でキーを差し替えるのにかかる時間",
    ],
  },
  "route-without-auth": {
    title: "全顧客データを誰でも書き出せる",
    category: "脆弱性",
    severity: "高",
    what_happens:
      "/api/export には認証がなく、URLを知っていれば誰でも全顧客の氏名・メール・電話番号を取得できる。社内用のつもりでも、サーバーが外から見える場所にあれば外部からも呼べる。",
    who: "A社（個人情報漏洩の当事者）、顧客",
    options: [
      {
        label: "認証チェックを足す",
        change_summary: "他のAPIと同じキーのチェックを export にも入れる。",
        effects: {
          security:
            "キーを知らない人は呼べなくなる。キーを持っているB社からは全件取得できる状態が残る。",
          effort: "1行の追加。すぐ終わる。",
          stakeholders:
            "社内の月末作業でキーを使うよう手順を変える必要がある。",
          operations: "社内用と提携先用の権限が分かれていないことは残る。",
        },
      },
      {
        label: "社内からだけ呼べるようにする",
        change_summary:
          "export を社内ネットワークからのアクセスだけ受け付けるようにする（サーバー設定またはコードでIPを制限）。",
        effects: {
          security: "外部からは呼べなくなる。社内の誰でも呼べる状態は残る。",
          effort: "インフラ側の設定が必要。半日〜1日。",
          stakeholders:
            "B社への影響はない。在宅勤務の社員が使う場合は経路を用意する必要がある。",
          operations:
            "サーバーを移したときに設定が抜けないよう、手順に残す必要がある。",
        },
      },
      {
        label: "export を削除する",
        change_summary:
          "APIとしての export をなくし、月末の突き合わせはDBから直接出力する手順に変える。",
        effects: {
          security: "このAPI経由の漏洩はなくなる。",
          effort: "コードの削除はすぐ。代わりの手順づくりに半日程度。",
          stakeholders: "月末作業の担当者の手間が増える可能性がある。",
          operations: "DBに直接触れる人が必要になる（2人のチームで回せるか）。",
        },
      },
    ],
    unknowns: [
      "このサーバーが外部から見える場所にあるか",
      "月末の突き合わせを誰が、どれくらいの頻度で行っているか",
    ],
  },
  "pii-in-logs": {
    title: "検索のたびに個人情報がログに残る",
    category: "運用",
    severity: "中",
    what_happens:
      "検索に当たった顧客の氏名・メール・電話番号がそのままログに書かれる。ログは見られる人が多く、保存期間も長いことが多いため、DB以外の場所から個人情報が漏れる経路になる。",
    who: "A社、顧客",
    options: [
      {
        label: "ログから個人情報を外す",
        change_summary: "ログには顧客IDと件数だけを書く。",
        effects: {
          security:
            "これから書かれるログからは漏れなくなる。過去のログは残る。",
          effort: "数行の修正。すぐ終わる。",
          stakeholders: "B社への影響はない。",
          operations:
            "問い合わせ対応で「誰を検索したか」を追いたいときは、IDからDBを引く必要がある。",
        },
      },
      {
        label: "伏せ字にして残す",
        change_summary:
          "メールは先頭2文字、電話は下4桁だけ残すなど、伏せ字にしてログに書く。",
        effects: {
          security: "漏れても個人を特定しにくくなる。完全にはなくならない。",
          effort: "伏せ字の関数を作る。半日程度。",
          stakeholders: "B社への影響はない。",
          operations:
            "どこまで伏せるかのルールを決めて、他のログにも揃える必要がある。",
        },
      },
      {
        label: "過去のログも消す",
        change_summary:
          "個人情報を外す修正に加えて、すでに書かれたログを削除し、保存期間を決める。",
        effects: {
          security: "過去分も含めて、ログからの漏洩がなくなる。",
          effort: "ログの保存場所の確認と削除作業が必要。1日程度。",
          stakeholders: "B社への影響はない。",
          operations:
            "障害調査で過去のログを見られなくなる。消す範囲を決めてから作業する必要がある。",
        },
      },
    ],
    unknowns: [
      "ログがどこに、どれくらいの期間保存されているか",
      "ログを見られる人が誰か",
    ],
  },
  "select-all-columns": {
    title: "必要以上の個人情報を返している",
    category: "運用",
    severity: "中",
    what_happens:
      "SELECT * で顧客テーブルの全カラムを返しているため、相手が使わない項目（メールや電話番号など）まで渡している。テーブルに列を追加すると、その列も自動で外に出ていく。",
    who: "A社、B社（受け取ったデータの管理責任が増える）、顧客",
    options: [
      {
        label: "返す列を決めて絞る",
        change_summary:
          "B社のサポート窓口が実際に使う列だけを SELECT で指定して返す。",
        effects: {
          security: "渡す個人情報が減る。列を追加しても勝手に外には出ない。",
          effort: "修正自体は短い。どの列が必要かB社に確認する時間がかかる。",
          stakeholders:
            "B社が今使っている列を消してしまうと、窓口の業務に影響する。",
          operations: "列を増やすときは、返すかどうかを毎回決める必要がある。",
        },
      },
      {
        label: "社内用と提携先用でAPIを分ける",
        change_summary:
          "提携先向けには必要な列だけ返すAPIを作り、全列が必要な処理は社内用に分ける。",
        effects: {
          security: "提携先に渡る情報を最小限にできる。",
          effort: "APIを分ける設計が必要。2〜3日。",
          stakeholders:
            "B社はURLの差し替えが必要。C社には最初から提携先用を渡せる。",
          operations: "API が増える分、2人のチームで保守する範囲が増える。",
        },
      },
    ],
    unknowns: [
      "B社が実際にどの列を使っているか",
      "B社との契約で、渡してよいデータの範囲が決まっているか",
    ],
  },
  "cors-wildcard": {
    title: "どのサイトからでもAPIを呼べる",
    category: "脆弱性",
    severity: "低",
    what_happens:
      "ブラウザ上のどのサイトからでもこのAPIにリクエストを送れる設定になっている。キーがブラウザ側に置かれている場合、他のサイトから悪用される経路になる。",
    who: "A社",
    options: [
      {
        label: "B社のドメインだけ許可",
        change_summary: "CORS の許可先を B社の管理画面のドメインに限定する。",
        effects: {
          security: "他のサイトからブラウザ経由で呼ばれることはなくなる。",
          effort: "設定の変更だけ。すぐ終わる。",
          stakeholders: "C社が加わったときに許可先を追加する必要がある。",
          operations: "提携先が増えるたびに設定を変える手順が必要。",
        },
      },
      {
        label: "CORS の設定を外す",
        change_summary:
          "B社がサーバー同士で呼んでいるなら CORS は不要なので、設定ごと外す。",
        effects: {
          security: "ブラウザから直接呼ばれることがなくなる。",
          effort: "設定の削除だけ。",
          stakeholders:
            "B社がブラウザから直接呼んでいた場合、その機能が動かなくなる。",
          operations: "B社の呼び出し方を確認してから入れる必要がある。",
        },
      },
    ],
    unknowns: ["B社がブラウザから直接このAPIを呼んでいるかどうか"],
  },
  "debug-enabled": {
    title: "デバッグモードのまま公開している",
    category: "運用",
    severity: "中",
    what_happens:
      "エラーが起きたときに、コードの中身や設定がそのまま画面に表示される。Flask のデバッグモードでは、条件によってはサーバー上で任意のコードを実行される危険もある。",
    who: "A社",
    options: [
      {
        label: "debug を環境変数で切り替える",
        change_summary: "debug=True をやめ、環境変数で開発時だけオンにする。",
        effects: {
          security: "本番でエラー内容が外に出なくなる。",
          effort: "数行の修正。すぐ終わる。",
          stakeholders: "B社への影響はない。",
          operations: "エラーの詳細はログで確認する必要がある。",
        },
      },
      {
        label: "本番用のサーバーで起動する",
        change_summary:
          "Flask の開発用サーバーをやめ、gunicorn などの本番用サーバーで起動する。",
        effects: {
          security: "デバッグ機能が本番で動くことがなくなる。",
          effort: "起動方法とサーバー設定の変更。半日程度。",
          stakeholders:
            "切り替え時に短時間APIが止まる。B社の取得時間（6時）を避ける必要がある。",
          operations:
            "起動手順が変わるので、引き継ぎ資料を更新する必要がある。",
        },
      },
    ],
    unknowns: ["本番サーバーで今どの起動方法を使っているか"],
  },
};

export const INCIDENTS: Record<string, IncidentText> = {
  "debug-enabled": {
    day: 4,
    incident_title:
      "B社の担当者から「エラー画面にプログラムの中身が表示された」とスクリーンショットが届いた",
    incident_story:
      "公開4日目の朝、B社の開発者が日付を間違えて呼び出したところ、Flask のデバッグ画面が表示された。画面にはファイルのパスやコードの一部がそのまま出ていた。",
    signals: [
      {
        time: "09:41:12",
        source: "api.log",
        level: "error",
        text: "GET /api/purchases?date=2026-13-01 500 ValueError: month must be in 1..12",
      },
      {
        time: "09:41:12",
        source: "api.log",
        level: "warn",
        text: "Debugger is active! Debugger PIN: 312-881-047",
      },
      {
        time: "10:05:30",
        source: "B社から",
        level: "warn",
        text: "「エラー画面にソースコードのようなものが出ています。これは見えていて大丈夫ですか？」",
      },
    ],
    view: "code",
    affected: ["api", "outsider"],
  },
  "cors-wildcard": {
    day: 19,
    incident_title: "見覚えのないサイトから、ブラウザ経由でAPIが呼ばれている",
    incident_story:
      "アクセスログを見ていた社内担当が、B社とは関係のないサイトから送られてきたリクエストに気づいた。今のところキーがないので弾かれているが、件数が増えている。",
    signals: [
      {
        time: "14:02:44",
        source: "api.log",
        level: "info",
        text: "OPTIONS /api/customers/search Origin: https://free-coupon.example 200",
      },
      {
        time: "14:02:44",
        source: "api.log",
        level: "warn",
        text: "GET /api/customers/search Origin: https://free-coupon.example 401",
      },
      {
        time: "14:03:10",
        source: "監視",
        level: "warn",
        text: "見慣れない Origin からのリクエストが1時間で214件",
      },
    ],
    view: "code",
    affected: ["api", "outsider"],
  },
  "pii-in-logs": {
    day: 33,
    incident_title:
      "ログ置き場の容量アラート。中を見ると顧客のメールアドレスと電話番号が大量に残っていた",
    incident_story:
      "ログの容量が上限に近づいたため社内担当が中身を確認したところ、検索のたびに顧客の氏名・メール・電話番号が書き出されていた。ログ置き場は開発メンバー全員が見られる設定になっている。",
    signals: [
      {
        time: "11:20:05",
        source: "監視",
        level: "warn",
        text: "ログ領域の使用率 92%",
      },
      {
        time: "11:24:51",
        source: "api.log",
        level: "info",
        text: "customer hit: 山田 花子 hanako.y@example.jp 090-1234-5678",
      },
      {
        time: "11:24:51",
        source: "api.log",
        level: "info",
        text: "customer hit: 佐藤 健 ken.sato@example.jp 080-2222-3333",
      },
      {
        time: "11:30:00",
        source: "社内チャット",
        level: "warn",
        text: "「このログ、外部委託の人も見られる場所ですよね…？」",
      },
    ],
    view: "code",
    affected: ["api", "b_support", "a_staff"],
  },
  "select-all-columns": {
    day: 47,
    incident_title:
      "B社のサポート担当者が、画面に出る必要のない顧客の電話番号を見ていたことがわかった",
    incident_story:
      "B社から「検索結果に電話番号まで出てくるので、担当者が顧客に直接電話してしまった」と報告があった。B社のサポート画面には、A社が返した項目がそのまま表示されている。",
    signals: [
      {
        time: "16:12:40",
        source: "api.log",
        level: "info",
        text: "GET /api/customers/search?name=田中 200 (columns: id,name,email,phone,address,birthday)",
      },
      {
        time: "16:40:02",
        source: "B社から",
        level: "warn",
        text: "「検索結果に電話番号と生年月日まで出てきます。こちらで使っていいデータでしょうか？」",
      },
    ],
    view: "code",
    affected: ["api", "b_support"],
  },
  "route-without-auth": {
    day: 61,
    incident_title:
      "深夜、見知らぬIPアドレスから全顧客データの書き出しが3回呼ばれていた",
    incident_story:
      "月末の作業で社内担当がログを確認したところ、深夜2時台に社外のIPアドレスから /api/export が呼ばれ、毎回全件が返っていた。認証なしで呼べるURLだったことにここで気づいた。",
    signals: [
      {
        time: "02:14:09",
        source: "api.log",
        level: "warn",
        text: "GET /api/export 200 12,480 rows  from 203.0.113.77",
      },
      {
        time: "02:14:51",
        source: "api.log",
        level: "warn",
        text: "GET /api/export 200 12,480 rows  from 203.0.113.77",
      },
      {
        time: "02:16:03",
        source: "api.log",
        level: "warn",
        text: "GET /api/export 200 12,480 rows  from 203.0.113.77",
      },
      {
        time: "09:30:00",
        source: "社内担当",
        level: "error",
        text: "「この時間、社内では誰も作業していません」",
      },
    ],
    view: "infra",
    affected: ["api", "a_db", "outsider", "a_staff"],
  },
  "sql-string-build": {
    day: 88,
    incident_title:
      "B社サポート窓口から「名前で検索したら全員分の顧客が出てきた」と連絡",
    incident_story:
      "B社のサポート担当者が、記号の入った名前で検索したところ、全顧客の情報が一覧で表示された。同じ時間帯に、検索APIへ不自然な文字列を送るリクエストも記録されていた。",
    signals: [
      {
        time: "13:05:22",
        source: "api.log",
        level: "info",
        text: "GET /api/customers/search?name=%' OR '1'='1 200 (12,480 hits)",
      },
      {
        time: "13:05:23",
        source: "api.log",
        level: "error",
        text: "GET /api/purchases?date=2026-07-01' UNION SELECT * FROM customers -- 500",
      },
      {
        time: "13:20:10",
        source: "B社から",
        level: "error",
        text: "「名前検索で全員分出てきました。システムがおかしくないですか？」",
      },
    ],
    view: "code",
    affected: ["api", "a_db", "b_support", "outsider"],
  },
  "hardcoded-secret": {
    day: 120,
    incident_title:
      "C社との接続準備で、B社と同じAPIキーを渡そうとしていることに気づいた",
    incident_story:
      "来年接続予定のC社に向けて手順書を作っていたところ、APIキーがコードに直接書かれていて、B社と同じキーを渡すしかないことがわかった。担当者の1人はすでに別プロジェクトに移っている。",
    signals: [
      {
        time: "10:00:00",
        source: "社内チャット",
        level: "info",
        text: "「C社にはどのキーを渡せばいいですか？」",
      },
      {
        time: "10:12:31",
        source: "git",
        level: "warn",
        text: 'app.py:22  PARTNER_API_KEY = "a-company-partner-2024"  (最終更新: 異動したメンバー)',
      },
      {
        time: "10:20:00",
        source: "社内チャット",
        level: "warn",
        text: "「キーを変えるとB社のバッチも止まりますよね…」",
      },
    ],
    view: "infra",
    affected: ["api", "b_batch", "b_support"],
  },
};
