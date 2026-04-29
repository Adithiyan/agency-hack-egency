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
from flask_cors import CORS

from phantom_flow.config import DEMO_DIR, PROCESSED_DIR, RAW_DIR, load_settings
from phantom_flow.corporations import lookup_many
from phantom_flow.matching import match_one
from phantom_flow.normalize import normalize_name
from phantom_flow.scoring import is_zombie, months_between, score_entity

REPO_ROOT = Path(__file__).parent
WEB_DIR = REPO_ROOT / "web"

app = Flask(__name__, static_folder=str(WEB_DIR), static_url_path="")
CORS(app, origins=os.getenv("ALLOWED_ORIGINS", "*").split(","))

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


INVESTIGATE_SYSTEM = """You are a senior public-sector enforcement analyst.
Your job: review a ranked list of zombie grant recipients and autonomously select
the SINGLE most compelling case for immediate investigation.

Rules:
- Use only the structured facts provided — no external knowledge.
- Do not assert fraud, criminality, or legal liability.
- Be direct, specific, and action-oriented — like a CBC journalist briefing an editor.
- Write in plain language a minister can act on.
"""

INVESTIGATE_PROMPT = """You are reviewing {count} zombie candidates — organizations that
received public grants and then dissolved, went inactive, or stopped filing.

Your task (3 parts):

PART 1 — SELECTION
Choose the single most compelling case for investigation. State which entity you chose
and in 2 sentences explain WHY this case is more actionable than the others.

PART 2 — FORENSIC NARRATIVE (200-250 words)
Write a CBC-style investigative narrative for the chosen case covering:
- Funding timeline (who gave how much and when)
- What happened (dissolution/inactivity signal and timing)
- Why this matters (public value at risk, funding dependency pattern)
- What a recovery action would look like

PART 3 — RED FLAGS (bullet list)
List 3-5 specific red flags from the evidence. Each flag must cite a fact from the data.

FORMAT your response exactly as:
## Selected case: [entity name]
### Why this case
[2 sentences]
### Forensic narrative
[narrative]
### Red flags
- [flag 1]
- [flag 2]
...

CANDIDATE CASES:
{cases}
"""


@app.route("/api/investigate", methods=["POST"])
def api_investigate():
    """Autonomous AI investigation — picks most compelling zombie case."""
    results_path = PROCESSED_DIR / "results.json"
    if not results_path.exists():
        return jsonify({"error": "No results. Run the pipeline first."}), 404

    rows = json.loads(results_path.read_text(encoding="utf-8"))
    zombies = [r for r in rows if r.get("is_zombie")]
    if not zombies:
        return jsonify({"error": "No zombie candidates found in current results."}), 404

    # Top 8 by ROI score for the LLM to reason over
    top = sorted(zombies, key=lambda x: x.get("roi_score", 0), reverse=True)[:8]

    def fmt_case(r: dict, i: int) -> str:
        flags = ", ".join(r.get("flags") or []) or "none"
        return (
            f"Candidate {i+1}: {r.get('display_name') or r.get('name_clean')}\n"
            f"  Province: {r.get('province','?')} | Recipient type: {r.get('recipient_type','?')}\n"
            f"  Total awarded: ${float(r.get('total_awarded',0) or 0):,.0f}\n"
            f"  Programs: {', '.join((r.get('programs') or [])[:4])}\n"
            f"  Corporate status: {r.get('status','unknown')} | Dissolution: {r.get('dissolution_date','unknown')}\n"
            f"  Last award date: {str(r.get('last_award_date','?'))[:10]}\n"
            f"  Months award→dissolution: {r.get('months_to_dissolution','?')}\n"
            f"  ROI score: {r.get('roi_score',0):.0f}/100 | Confidence: {r.get('confidence','?')}\n"
            f"  Funding dependency: {r.get('funding_dependency','?')}\n"
            f"  Flags: {flags}\n"
        )

    cases_text = "\n".join(fmt_case(r, i) for i, r in enumerate(top))
    prompt = INVESTIGATE_PROMPT.format(count=len(top), cases=cases_text)

    try:
        from phantom_flow.llm import TemplateLLMClient, build_llm_client
        llm = build_llm_client()
        if isinstance(llm, TemplateLLMClient):
            # No LLM configured — build a deterministic investigation from top case
            r = top[0]
            result = (
                f"## Selected case: {r.get('display_name') or r.get('name_clean')}\n"
                f"### Why this case\n"
                f"This entity received ${float(r.get('total_awarded',0) or 0):,.0f} in federal funding "
                f"and {r.get('status','dissolved').lower()} {r.get('months_to_dissolution','?')} months "
                f"after its last award — the tightest dissolution window in the current dataset. "
                f"Its ROI score of {r.get('roi_score',0):.0f}/100 and {r.get('confidence','medium')} "
                f"confidence match make it the most defensible referral candidate.\n"
                f"### Forensic narrative\n"
                f"{r.get('case_summary') or 'No AI summary generated yet. Set GEMINI_API_KEY and rerun the pipeline.'}\n"
                f"### Red flags\n"
                + "\n".join(f"- {f}" for f in (r.get("flags") or ["zombie_12mo"]))
            )
        else:
            result = llm.complete(INVESTIGATE_SYSTEM, prompt, max_tokens=700)
    except Exception as exc:
        return jsonify({"error": f"LLM investigation failed: {exc}"}), 500

    # Find the entity the LLM selected (best effort parse)
    selected_entity = None
    for r in top:
        name = (r.get("display_name") or r.get("name_clean") or "").lower()
        if name and name[:15] in result.lower():
            selected_entity = r
            break
    if not selected_entity:
        selected_entity = top[0]

    return jsonify({
        "investigation": result,
        "selected_entity": selected_entity,
        "candidates_reviewed": len(top),
    })


CHAT_SYSTEM = """You are the AI assistant for Phantom Flow, a Canadian federal grant enforcement triage tool.

You have deep knowledge of:
- The Phantom Flow system: detects zombie recipients (organizations that received federal grants and dissolved within 12 months)
- ROI scoring (4 components: recoverable 35pts, evidence 30pts, pursuit cost 20pts, exposure 15pts)
- Recommendation tiers: immediate referral, compliance letter, review, monitor, write off
- Canadian grants data from open.canada.ca proactive disclosure portal (~200K rows)
- Corporate matching via Corporations Canada using fuzzy name matching
- Funding dependency proxy: multi-year × multi-department concentration
- The 12-month zombie window from the Ottawa AI Hackathon challenge spec

Rules:
- Answer questions even when no data is loaded — explain methodology, system design, how to use the tool
- When data context is provided, use it to answer specific questions about entities
- Be concise, direct, and plain-language — like briefing a government analyst
- Never assert fraud, criminality, or legal liability
- If the user hasn't loaded data yet, explain how to get started"""

@app.route("/api/chat", methods=["POST"])
def api_chat():
    """Answer a user question about the current enforcement data."""
    data = request.get_json(force=True, silent=True) or {}
    question = str(data.get("question", "")).strip()
    context  = str(data.get("context", "")).strip()
    has_data = bool(data.get("has_data", False))
    if not question:
        return jsonify({"error": "question required"}), 400

    data_section = f"Current enforcement data:\n{context}" if has_data and context else "No data loaded yet in the user's session."
    prompt = f"{data_section}\n\nUser question: {question}"
    try:
        from phantom_flow.llm import TemplateLLMClient, build_llm_client
        llm = build_llm_client()
        if isinstance(llm, TemplateLLMClient):
            return jsonify({"answer": None}), 200  # JS will use local fallback
        answer = llm.complete(CHAT_SYSTEM, prompt, max_tokens=400)
        return jsonify({"answer": answer})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8765))
    print(f"\n  Phantom Flow server -> http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
