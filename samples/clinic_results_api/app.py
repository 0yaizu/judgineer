"""
ひかり診療所 検査結果API

患者向けアプリと外部の検査会社に、検査結果と関連文書を提供する。
"""
import csv
import io
import os
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=[os.environ.get("FRONTEND_ORIGIN", "http://127.0.0.1:3000")])

# 検査会社と患者向けアプリで共通のAPIキー
RESULTS_API_KEY = os.environ["RESULTS_API_KEY"]
DB_PATH = Path(os.environ.get("DATA_DIR", Path(__file__).parent)) / "clinic.db"


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def check_key():
    return secrets.compare_digest(
        request.headers.get("X-API-Key", ""), RESULTS_API_KEY
    )


@app.route("/api/patients/<patient_id>/results")
def patient_results(patient_id):
    """患者向けアプリが検査結果を表示するときに使う"""
    if not check_key():
        return jsonify({"error": "unauthorized"}), 401
    with get_db() as db:
        rows = db.execute(
            f"SELECT patient_id, diagnosis, result, tested_at FROM test_results WHERE patient_id = '{patient_id}'"
        ).fetchall()
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
    fields = ["name", "email", "phone", "birth_date", "diagnosis", "result", "tested_at"]
    with get_db() as db:
        rows = db.execute(
            "SELECT patients.name, patients.email, patients.phone, patients.birth_date, "
            "test_results.diagnosis, test_results.result, test_results.tested_at "
            "FROM patients JOIN test_results ON patients.id = test_results.patient_id"
        ).fetchall()
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(dict(row) for row in rows)
    return Response(output.getvalue(), mimetype="text/csv")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002)
