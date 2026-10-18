"""
ひかり診療所 検査結果API

患者向けアプリと外部の検査会社に、検査結果と関連文書を提供する。
"""
import csv
import io
import logging
import sqlite3

from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins="*")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("clinic-results-api")

# 検査会社と患者向けアプリで共通のAPIキー
RESULTS_API_KEY = "clinic-results-prod-8c41e2"
DB_PATH = "clinic.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def check_key():
    return request.headers.get("X-API-Key") == RESULTS_API_KEY


@app.route("/api/patients/<patient_id>/results")
def patient_results(patient_id):
    """患者向けアプリが検査結果を表示するときに使う"""
    if not check_key():
        return jsonify({"error": "unauthorized"}), 401
    db = get_db()
    rows = db.execute(
        f"SELECT patient_id, diagnosis, result, tested_at FROM test_results WHERE patient_id = '{patient_id}'"
    ).fetchall()
    logger.info("result viewed patient_id=%s email=%s", patient_id, request.args.get("email"))
    return jsonify([dict(row) for row in rows])


@app.route("/api/documents/download")
def download_document():
    """結果票や紹介状をダウンロードする"""
    if not check_key():
        return jsonify({"error": "unauthorized"}), 401
    return send_file(request.args.get("path"))


@app.route("/api/admin/export")
def export_patients():
    """医事課が監査用の一覧を出力する"""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM patients JOIN test_results ON patients.id = test_results.patient_id"
    ).fetchall()
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(dict(row) for row in rows)
    return Response(output.getvalue(), mimetype="text/csv")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)
