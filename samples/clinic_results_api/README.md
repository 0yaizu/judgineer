# ひかり診療所 検査結果API

患者向けアプリに、検査結果や関連文書を提供するAPIです。

起動時に `RESULTS_API_KEY` を環境変数で指定します。

| エンドポイント | 使う人 | 内容 |
|---|---|---|
| `GET /api/patients/<id>/results` | 患者向けアプリ | 患者ごとの検査結果 |
| `GET /api/documents/download?path=` | 患者向けアプリ | 結果票PDFのダウンロード |
| `GET /api/admin/export` | 医事課 | 患者情報と検査結果のCSV出力 |

