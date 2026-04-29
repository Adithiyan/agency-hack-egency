"""Phantom Flow enforcement triage dashboard."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import streamlit as st

REPO_ROOT = Path(__file__).resolve().parents[1]
RESULTS_PATH = REPO_ROOT / "data" / "processed" / "results.json"
DEMO_RESULTS_PATH = REPO_ROOT / "data" / "demo" / "results_demo.json"

st.set_page_config(page_title="Phantom Flow", layout="wide")

REC_COLOR = {
    "immediate referral": "#b00020",
    "compliance letter": "#b58900",
    "review": "#586e75",
    "write off": "#6c757d",
}


@st.cache_data
def load_results() -> pd.DataFrame:
    path = RESULTS_PATH if RESULTS_PATH.exists() else DEMO_RESULTS_PATH
    if not path.exists():
        return pd.DataFrame()
    rows = json.loads(path.read_text(encoding="utf-8"))
    return pd.DataFrame(rows)


def _format_money(value: float) -> str:
    if pd.isna(value):
        return "n/a"
    if value >= 1e6:
        return f"${value / 1e6:.1f}M"
    if value >= 1e3:
        return f"${value / 1e3:.0f}K"
    return f"${value:,.0f}"


df = load_results()

st.title("Phantom Flow")
st.caption("Enforcement triage for federal grant recipients that dissolved post-award.")

if df.empty:
    st.warning(
        "No results found. Run `python -m phantom_flow.pipeline --demo` to generate "
        "`data/processed/results.json`, or place a fixture at "
        "`data/demo/results_demo.json`."
    )
    st.stop()

zombie_df = df[df.get("is_zombie", False) == True] if "is_zombie" in df.columns else df

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Entities analyzed", f"{len(df):,}")
c2.metric("Zombie candidates", f"{len(zombie_df):,}")
c3.metric(
    "High priority",
    f"{int((df['recommendation'] == 'immediate referral').sum()):,}",
)
c4.metric("Total awarded", _format_money(df["total_awarded"].sum()))
c5.metric("Est. recoverable", _format_money(df.get("estimated_recoverable", pd.Series(dtype=float)).sum()))

st.divider()

with st.sidebar:
    st.header("Filters")
    rec_options = ["All"] + sorted(df["recommendation"].dropna().unique().tolist())
    rec = st.selectbox("Recommendation", rec_options)
    prov_col = "province" if "province" in df.columns else None
    prov = st.selectbox(
        "Province",
        ["All"] + (sorted(df[prov_col].dropna().unique().tolist()) if prov_col else []),
    )
    conf_options = ["All"] + sorted(df["confidence"].dropna().unique().tolist())
    conf = st.selectbox("Confidence", conf_options)
    min_score, max_score = st.slider("ROI score range", 0, 100, (0, 100))
    only_zombies = st.checkbox("Only zombies", value=True)

filtered = df.copy()
if rec != "All":
    filtered = filtered[filtered["recommendation"] == rec]
if prov_col and prov != "All":
    filtered = filtered[filtered[prov_col] == prov]
if conf != "All":
    filtered = filtered[filtered["confidence"] == conf]
filtered = filtered[
    (filtered["roi_score"] >= min_score) & (filtered["roi_score"] <= max_score)
]
if only_zombies and "is_zombie" in filtered.columns:
    filtered = filtered[filtered["is_zombie"] == True]

filtered = filtered.sort_values("roi_score", ascending=False).reset_index(drop=True)

st.subheader(f"Ranked enforcement queue ({len(filtered):,} cases)")

table_cols = [
    c
    for c in [
        "display_name",
        "province",
        "total_awarded",
        "estimated_recoverable",
        "status",
        "months_to_dissolution",
        "roi_score",
        "recommendation",
        "confidence",
    ]
    if c in filtered.columns
]
st.dataframe(
    filtered[table_cols],
    use_container_width=True,
    hide_index=True,
    column_config={
        "total_awarded": st.column_config.NumberColumn("Awarded", format="$%.0f"),
        "estimated_recoverable": st.column_config.NumberColumn("Recoverable", format="$%.0f"),
        "roi_score": st.column_config.ProgressColumn("ROI", min_value=0, max_value=100),
    },
)

st.divider()
st.subheader("Case detail")

label_col = "display_name" if "display_name" in filtered.columns else "name_clean"
if filtered.empty:
    st.info("No cases match current filters.")
    st.stop()

selected_label = st.selectbox("Select case", filtered[label_col].tolist())
case = filtered[filtered[label_col] == selected_label].iloc[0].to_dict()

left, right = st.columns([2, 1])
with left:
    st.markdown(f"### {case.get(label_col)}")
    rec_color = REC_COLOR.get(case.get("recommendation", ""), "#444")
    st.markdown(
        f"<span style='background:{rec_color};color:white;padding:4px 10px;"
        f"border-radius:4px;font-weight:600'>"
        f"{case.get('recommendation', 'review').upper()}</span>",
        unsafe_allow_html=True,
    )
    st.markdown("**AI case summary**")
    st.write(case.get("case_summary") or "Summary not generated for this case.")
    st.markdown("**Flags**")
    flags = case.get("flags") or []
    st.write(", ".join(flags) if flags else "none")
    st.markdown("**Sample descriptions**")
    descs = case.get("sample_descriptions") or []
    if descs:
        for d in descs:
            st.write(f"- {d}")
    else:
        st.write("none recorded")

with right:
    st.markdown("**Scoring**")
    st.metric("ROI score", f"{case.get('roi_score', 0):.1f}")
    breakdown = case.get("score_breakdown") or {}
    if breakdown:
        st.write(
            pd.DataFrame.from_dict(breakdown, orient="index", columns=["points"]).round(2)
        )
    st.markdown("**Evidence**")
    st.write({
        "matched_name": case.get("matched_name"),
        "match_confidence": case.get("match_confidence"),
        "status": case.get("status"),
        "dissolution_date": case.get("dissolution_date"),
        "last_award_date": case.get("last_award_date"),
        "months_to_dissolution": case.get("months_to_dissolution"),
        "jurisdiction": case.get("jurisdiction"),
    })

st.caption(
    "Phantom Flow surfaces public-record patterns. It does not assert wrongdoing. "
    "Confirm every case against authoritative sources before acting."
)
