# Partner Portal API

社外制作会社が、案件ごとの素材を取得し、変換完了通知を受け取るためのAPIです。

| エンドポイント | 内容 |
|---|---|
| `GET /api/files/:projectId` | 指定された素材を返す |
| `GET /api/reports/:projectId` | 案件の利用状況を返す |
| `POST /api/webhooks` | 通知先URLを登録して疎通確認する |
| `PATCH /api/members/me` | 担当者プロフィールを更新する |
| `GET /auth/complete` | ログイン後に元の画面へ戻す |

APIは社内ネットワーク上のDBとファイル共有へアクセスします。パートナーは案件単位のアクセストークンを利用します。
