"""Phantom Flow — Flask development server.

Serves the static web app and exposes a small JSON API so the browser can:
  - GET  /api/status        — server health + current settings
  - GET  /api/results       — current results.json
  - POST /api/settings      — update API key, toggle live corp
  - POST /api/run           — run the pipeline (demo or live)
  - POST /api/upload        — accept a grants CSV upload
  - POST /api/lookup        — look up a single entity name

Run:
    PYTHONPATH=src python server.py
Then open http://localhost:8765
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from flask import Flask, jsonify, request, send_from_directory

from phantom_flow.config import DEMO_DIR, PROCESSED_DIR, RAW_DIR, load_settings
from phantom_flow.corporations import lookup_many
from phantom_flow.matching import match_one
from phantom_flow.normalize import normalize_name
from phantom_flow.scoring import is_zombie, months_between, score_entity

REPO_ROOT = Path(__file__).parent
WEB_DIR = REPO_ROOT / "web"

app = Flask(__name__, static_folder=str(WEB_DIR), static_url_path="")

# Runtime state
_pipeline_lock = threading.Lock()
_pipeline_status = {"running": False, "last_run": None, "error": None, "rows": 0}

# ── Static files ──────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    target = WEB_DIR / path
    if target.exists() and target.is_file():
        return send_from_directory(WEB_DIR, path)
    return send_from_directory(WEB_DIR, "index.html")


# ── API ───────────────────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status():
    results_path = PROCESSED_DIR / "results.json"
    rows = 0
    if results_path.exists():
        try:
            rows = len(json.loads(results_path.read_text(encoding="utf-8")))
        except Exception:
            pass
    return jsonify({
        "ok": True,
        "anthropic_key_set": bool(os.getenv("ANTHROPIC_API_KEY")),
        "live_corp": os.getenv("PHANTOM_FLOW_USE_LIVE_CORP", "false").lower() == "true",
        "results_rows": rows,
        "pipeline": _pipeline_status,
        "grants_csv_exists": (RAW_DIR / "grants.csv").exists(),
        "demo_csv_exists": (DEMO_DIR / "grants_demo.csv").exists(),
    })


@app.route("/api/results")
def api_results():
    path = PROCESSED_DIR / "results.json"
    if not path.exists():
        demo = DEMO_DIR / "results_demo.json"
        if demo.exists():
            return demo.read_text(encoding="utf-8"), 200, {"Content-Type": "application/json"}
        return jsonify({"error": "No results yet. Run the pipeline first."}), 404
    return path.read_text(encoding="utf-8"), 200, {"Content-Type": "application/json"}


@app.route("/api/settings", methods=["POST"])
def api_settings():
    data = request.get_json(force=True, silent=True) or {}

    # Update in-process env vars (affects next pipeline run in same process)
    if "anthropic_api_key" in data and data["anthropic_api_key"]:
        os.environ["ANTHROPIC_API_KEY"] = data["anthropic_api_key"].strip()

    if "use_live_corp" in data:
        os.environ["PHANTOM_FLOW_USE_LIVE_CORP"] = "true" if data["use_live_corp"] else "false"

    # Persist to .env so restarts remember the settings
    env_path = REPO_ROOT / ".env"
    lines = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    def upsert(key: str, value: str) -> None:
        for i, line in enumerate(lines):
            if line.startswith(key + "=") or line.startswith("# " + key):
                lines[i] = f"{key}={value}"
                return
        lines.append(f"{key}={value}")

    if "anthropic_api_key" in data and data["anthropic_api_key"]:
        upsert("ANTHROPIC_API_KEY", data["anthropic_api_key"].strip())
    if "use_live_corp" in data:
        upsert("PHANTOM_FLOW_USE_LIVE_CORP", "true" if data["use_live_corp"] else "false")

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return jsonify({"ok": True, "anthropic_key_set": bool(os.getenv("ANTHROPIC_API_KEY"))})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    """Accept a grants CSV and save it as data/raw/grants.csv."""
    if "file" not in request.files:
        return jsonify({"error": "No file field in request"}), 400
    f = request.files["file"]
    if not f.filename or not f.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only .csv files accepted"}), 400

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    target = RAW_DIR / "grants.csv"
    f.save(str(target))
    size_mb = target.stat().st_size / 1e6
    return jsonify({"ok": True, "path": str(target), "size_mb": round(size_mb, 2)})


@app.route("/api/run", methods=["POST"])
def api_run():
    """Trigger the pipeline in a background thread."""
    if _pipeline_status["running"]:
        return jsonify({"error": "Pipeline already running"}), 409

    data = request.get_json(force=True, silent=True) or {}
    demo = bool(data.get("demo", True))
    top_n = int(data.get("top_n", 25))

    def _run():
        _pipeline_status["running"] = True
        _pipeline_status["error"] = None
        try:
            from phantom_flow.pipeline import run as pipeline_run
            out = pipeline_run(demo=demo, top_n_summaries=top_n)
            rows = json.loads(out.read_text(encoding="utf-8"))
            _pipeline_status["rows"] = len(rows)
            _pipeline_status["last_run"] = str(out)
        except Exception as exc:
            _pipeline_status["error"] = str(exc)
        finally:
            _pipeline_status["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"ok": True, "demo": demo, "top_n": top_n})


@app.route("/api/pipeline-status")
def api_pipeline_status():
    return jsonify(_pipeline_status)


@app.route("/api/lookup", methods=["POST"])
def api_lookup():
    """Quick single-entity lookup: normalize name + corp search + score."""
    data = request.get_json(force=True, silent=True) or {}
    raw_name = str(data.get("name", "")).strip()
    if not raw_name:
        return jsonify({"error": "name required"}), 400

    name_clean = normalize_name(raw_name)
    settings = load_settings()
    settings_with_live = settings.__class__(
        **{**settings.__dict__, "use_live_corp": True}
    )
    try:
        records = lookup_many([name_clean], settings_with_live)
    except Exception as exc:
        return jsonify({"error": f"Corporate lookup failed: {exc}"}), 500

    record = records[0] if records else None
    if not record:
        return jsonify({"name_clean": name_clean, "matched": False})

    match = match_one(name_clean, record)
    entity = {"name_clean": name_clean, "display_name": raw_name, "total_awarded": 0,
              "programs": [], "funding_years": [], "annual_totals": {}}
    months = months_between(None, match.dissolution_date)
    zombie = is_zombie(match, None, settings.zombie_window_months)
    scoring = score_entity(entity, match, is_zombie_flag=zombie, months_to_dissolution=months)

    return jsonify({
        "name_clean": name_clean,
        "matched": bool(match.matched_name),
        "match": {
            "matched_name": match.matched_name,
            "confidence": match.confidence,
            "confidence_label": match.confidence_label,
            "status": match.status,
            "dissolution_date": match.dissolution_date,
            "incorporation_date": match.incorporation_date,
            "jurisdiction": match.jurisdiction,
            "source": match.source,
        },
        **scoring,
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8765))
    print(f"\n  Phantom Flow server -> http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
