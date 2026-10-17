import { type Architecture, type Background, SIM_DAYS } from "@tka/shared";
import type { Feature, Finding } from "../scanner";
import type { Issue } from "../types";
import { backgroundText, RULES, SOURCES_NOTE, tag } from "./common";

// 4 回の呼び出し (arch → flows_all ‖ issues → flows補完) で system を完全に同じ文字列にし、キャッシュを効かせる。
// 呼び出しごとに変わるもの (日時・乱数・タスクの指示) はここに入れない
export function analyzeSystem(a: {
  bg: Background;
  sources: string;
  config: string;
}): string {
  return [
    "あなたは、若手エンジニアが運用で起きる問題への判断を練習するための家庭教師です。",
    tag("rules", RULES),
    tag(
      "task",
      `次のアプリは開発が終わり、これから運用に入ります。公開日から${SIM_DAYS}日間の運用をシミュレーションする「台本」を作ります。
機械的なチェックは誤検知を含む候補（findings）を拾います。本当に問題なものが原因で、運用中のある日に問題が表に出てくる、という流れにします。
台本は何回かに分けて作ります。今回どの部分を作るかは、あとの依頼で指定します。`,
    ),
    tag("background", backgroundText(a.bg)),
    tag("config", a.config || "（なし）"),
    tag("source", `${SOURCES_NOTE}\n${a.sources}`),
  ].join("\n\n");
}

const ARCH_GUIDE = `- 背景・構成ファイル・コードから、このアプリに関わる要素をすべて nodes にする（DB、このアプリ、提携先の仕組み、社内の担当者、外部の第三者など）。数は減らさない。書かれていない要素は足さない。
- 常に動くサービス・定期バッチ・データの保存先（DB・キャッシュ・ファイル・バックアップ先）・外部サービスは、1つずつ node にし、まとめない。
- ボリュームやデータの置き場は、使うサービスや DB の node に含めて別の node にしない（バックアップの保存先は別の node にする）。マイグレーション・初期化など起動時に一度だけ動くコンテナは node にしない。
- 省かない: 外からの入口（リバースプロキシ・ロードバランサ等）、外部の認証（OAuth 等）、サービス同士をつなぐ中継役（Pub/Sub・キュー等）、ログ・監視の流れ。
- kind: internal=自社のシステム / db / partner=取引先 / person=人 / external=外部・不特定。
- edges は実際の通信・データの向きで引く。中継役を通してやり取りする場合は、直接つながず中継役を経由させる。
- direction: 片方向にしか流れないなら one、読み書きや問い合わせと応答のように両方向なら both。
- 人の edges は実際の使い方で引く。開発者・運用者のデプロイや設定変更は、自分たちのコードからビルドしているサービス（compose で build: があるもの）にだけ引く。image: だけで動かす既製品や外部サービスには引かない。開発者が動作確認で利用者と同じ経路を使うなら、その edge も引く。
- edges の label は「毎朝6時 前日分を取得」のように短く具体的に。`;

const FLOW_GUIDE = `- actor が人の場合は、その操作をする権限がコード上ある人にする。管理者・オーナー専用の操作を一般の利用者にさせない。権限が読み取れなければ、背景の関係者から無理のない人にする。
- title は「利用者がダッシュボードで活動ランキングを見る」のように、誰が何をするかを一文で。
- steps は、その場面で通る通信を順番に並べる。from→to は構成図の edges にあるもの（direction が both なら逆向きも可）だけを使う。応答（DB から読んだ値が画面に返る等）も逆向きの step として書く。label は step で流れるもの（例:「セッションを確認」「集計結果を返す」）。
- per_day: その流れが1日に起きる回数の目安。背景（利用者の数など）とコード（cron の設定など）から見積もる。毎日1回の定期バッチは 1、週に1回なら 0.14、ほとんど起きない手動作業は 0.01。`;

const part = (label: string, guide: string) =>
  `今回作るのは ${label} だけです。\n\n${tag("guide", guide)}`;

const featuresText = (features: Feature[]) =>
  features.map((f) => `- ${f.id}: ${f.name} (${f.source})`).join("\n") ||
  "（なし）";

export const archPrompt = () =>
  part("システム構成図（architecture）", ARCH_GUIDE);

export function flowsAllPrompt(a: {
  arch: Architecture;
  features: Feature[];
}): string {
  return [
    part(
      "使われ方（flows）と想定利用者数（assumed_users）",
      `${FLOW_GUIDE}
- person の node はそれぞれ1つ以上の flow を持つ。
- アプリの主な機能（コードのモジュール・パッケージ・コマンド・画面など）を、それぞれ1つ以上の flow にする。運用作業（バックアップ・監視など）に偏らせず、利用者が日常的に使う機能を中心にする。数は減らさない。
- 人の操作に加えて、定期実行のバッチなど人以外が起点の流れも入れる（actor はその node）。
- 機能一覧のすべての機能が、どれかの flow の feature_ids に入るようにする。1つの flow が複数機能を含んでよい。
- 背景に利用者数がなければ「利用者30人規模」と仮定して per_day を見積もり、仮定した人数を assumed_users で返す（背景に人数があればその数）。`,
    ),
    tag("architecture", JSON.stringify(a.arch)),
    tag("features", featuresText(a.features)),
  ].join("\n\n");
}

export function issuesPrompt(a: {
  findings: Finding[];
  arch: Architecture;
}): string {
  return [
    part(
      "運用中に起きる出来事（issues）と dismissed",
      `dismissed（問題にしない findings）:
- findings は機械的に拾った候補で、誤検知を含む。ソースと背景を見て、運用で実害につながらないものは issues にせず dismissed に入れる。reason は実害にならない理由を一文で。
- 例: テスト・サンプル・ドキュメント用のダミー値、本番では動かないコード、環境変数から読んだ値を代入しているだけの行、すでに対策されている箇所。
- 迷うものは issues に残す。影響が小さいだけのもの（運用の手違いや手間につながるが、被害は限られる）は dismissed にせず、issues に残して severity を「低」にする。dismissed にするのは、実害になる筋道が無いものだけ。
- 秘密の扱い（秘密の値の比べ方・全提携先で共通の鍵・コードへの直書き）に関する findings は、悪用できる筋道が現実にある限り dismissed にしない。「差が小さい」「実測しにくい」だけの理由で見送らず、issues に残して severity を「低」〜「中」にする。
- すべての findings を issues か dismissed のどちらかに必ず入れる。

issues（運用中に起きる出来事）:
- 1つの原因につき1件。同じ原因の findings はまとめてよい。finding_ids には根拠にした findings の id を入れる。findings にない問題は足さない。dismissed に入れたものは使わない。
- day は現実に起きそうな順番とタイミングにして、ばらけさせる。day の早い順に並べる。
- incident_title: その日に「観測されること」を一文で、30字以内（例:「B社サポート窓口から『検索結果がおかしい』と連絡が来た」）。原因の名前（SQLインジェクション等）はここでは書かない。
- view: 原因がコードの書き方なら code、構成・権限・運用体制なら infra。
- affected_nodes: 構成図の node の id だけを使う。
- title: 原因を一文で（20字前後）。
- severity: 次の基準で決める。
  - 高: 認証がない・弱い・共通の鍵のせいで、個人情報や機密データが外から読み出せる、または書き換え・削除できる。外から遠隔操作（任意コードの実行など）される入口になる。止まると契約違反（違約金など）に直結する。
  - 中: 条件がそろうと被害が出る（特定の相手や手順が必要）。漏れても範囲が限られる。復旧や運用の手間が増える。
  - 低: 影響が社内に閉じる、または実害につながりにくい。
  - 背景（扱うデータ・契約・チームの体制）を見て、1段階だけ上げ下げしてよい。ただし、個人情報に届く脆弱性は「中」を下回らない。
- 出来事の本文（経緯・ログ・影響など）は、あとで1件ずつ作る。ここでは書かない。
- if_ignored: 本人がこの出来事を「今回は対応しない」と見送った場合。
  - impact: 被害が広がる・より大きな形で表に出るなら escalate。テスト用ファイル・使われていないコード・影響が社内で小さく閉じるものなど、運用への影響が小さいなら none。reason は理由を一文で、25字以内（詳しい経緯はあとで別に書くので、ここでは要点だけ）。
  - escalate: after_days は 7〜90。incident_title は最初より深刻になった場面で「観測されること」を一文で、25字以内（書き方は上と同じ。原因の名前は書かない）。
  - none: after_days は 0、incident_title は空文字。`,
    ),
    tag("findings", JSON.stringify(a.findings, null, 1)),
    tag("architecture", JSON.stringify(a.arch)),
  ].join("\n\n");
}

export function extraFindingsPrompt(a: {
  findings: Finding[];
  focus: string;
}): string {
  return [
    part(
      "追加の指摘候補（candidates）",
      `- 今回の観点: ${a.focus}。この観点を重点的に見る。他の観点の問題は出さなくてよい。
- 機械のルールが拾えていない、運用で実際に問題になる欠陥を探す。known_findings と同じ問題は出さない。
- 候補にする前に、実際に到達する処理か、前後に認証・認可・入力検証・無害化・失敗時処理がないかを確認する。名前や1行だけから推測しない。
- 問題の成立に必要なコードがsourceに載っておらず確認できない場合は候補にしない。チェックが無いこと自体が問題の場合は、チェックされずに処理へ入る入口の行を根拠にする。
- 各候補は、問題のある行を source から一字一句コピーした1行にして quote に入れる。コピーできない（コードに実在しない）ものは出さない。file は source の見出しのファイル名、line はその行番号。
- why には、運用で何が起きるかを、背景（扱うデータ・契約・チームの体制）と結びつけて一文で書く。
- 出さないもの: 書き方の好み・命名・コメント・テストの不足・「あったほうがよい」程度の改善・確信が持てないもの。依存パッケージの版の脆弱性（ここでは確かめられない）。
- 同じ欠陥の言い換えは1件にまとめる。known_findings に含まれる欠陥を言い直したものも出さない。例外処理（try/except）が無いだけの指摘は出さない（失敗を握りつぶす・誤って成功を返すなど、結果が変わるものだけ出す）。
- 最大5件。無ければ空の配列。`,
    ),
    tag(
      "known_findings",
      a.findings
        .map((f) => `- ${f.rule}: ${f.title} (${f.file}:${f.line})`)
        .join("\n") || "（なし）",
    ),
  ].join("\n\n");
}

/** 骨組みの issue 1件ぶんの本文を作る。parent があれば、見送った結果として悪化した場面 */
export function detailPrompt(a: {
  issue: Pick<
    Issue,
    | "day"
    | "incident_title"
    | "title"
    | "category"
    | "severity"
    | "view"
    | "affected_nodes"
  >;
  findings: Finding[];
  arch: Architecture;
  others: { day: number; title: string; incident_title: string }[];
  parent?: { incident_story: string; reason: string };
}): string {
  const {
    day,
    incident_title,
    title,
    category,
    severity,
    view,
    affected_nodes,
  } = a.issue;
  return [
    part(
      "この出来事1件の本文（incident_story, signals, what_happens, who_is_affected, background_link）",
      `- incident_story: 2〜3文。気づいた人、時刻、状況を具体的に。incident_title の内容に合わせる。
- signals: 3〜6件。アクセスログ・エラーログ・監視アラート・取引先からの連絡など。time は "06:12:03" 形式、source は "api.log" "監視" "B社から" など。ログはそれらしい1行にする。
- 原因の名前（SQLインジェクション等）は incident_story と signals には書かない。
- what_happens: 原因と、放っておくと運用で何が起きるか（2〜3文）。
- who_is_affected: 背景に出てくる名前を使う。
- 登場する人物名・社名・サービス名は、背景とほかの出来事に合わせる（食い違わせない）。
- この出来事の day より後の出来事は、まだ起きていないものとして書く（触れない）。
- background_link: この問題に関係する背景の情報。なければ空文字。${
        a.parent
          ? "\n- これは、一度見送った出来事が悪化した場面。最初の出来事より深刻になった場面として書く。"
          : ""
      }`,
    ),
    tag(
      "issue",
      JSON.stringify({
        day,
        incident_title,
        title,
        category,
        severity,
        view,
        affected_nodes,
      }),
    ),
    tag(
      "timeline",
      `ほかの出来事（day 順）:\n${
        a.others
          .map((o) => `- day ${o.day}: ${o.incident_title}（${o.title}）`)
          .join("\n") || "（なし）"
      }`,
    ),
    ...(a.parent
      ? [
          tag(
            "first_incident",
            `最初の出来事: ${a.parent.incident_story}\n見送ると悪化する理由: ${a.parent.reason}`,
          ),
        ]
      : []),
    tag("findings", JSON.stringify(a.findings, null, 1)),
    tag("architecture", JSON.stringify(a.arch)),
  ].join("\n\n");
}

export function flowsMissingPrompt(a: {
  arch: Architecture;
  missing: Feature[];
}): string {
  return [
    `次の機能が、まだどの flow にも入っていません。これらの機能を使う flow だけを追加してください（すでにある flow は書かない）。\n\n${tag(
      "guide",
      `${FLOW_GUIDE}
- すべての機能が、追加する flow の feature_ids に入るようにする。1つの flow が複数機能を含んでよい。
- 構成図の上でどうしても表現できない機能は、flow を作らず省く。
- 背景に利用者数がなければ「利用者30人規模」と仮定して per_day を見積もる。`,
    )}`,
    tag("architecture", JSON.stringify(a.arch)),
    tag("missing_features", featuresText(a.missing)),
  ].join("\n\n");
}
