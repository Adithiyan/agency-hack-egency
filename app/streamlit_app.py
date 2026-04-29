from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from phantom_flow.pipeline import DEFAULT_OUTPUT, build_results

st.set_page_config(page_title="Phantom Flow", page_icon="PF", layout="wide")


@st.cache_data
def load_results() -> list[dict]:
    if not DEFAULT_OUTPUT.exists():
        build_results()
    return json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))


def money(value: float) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    return f"${value:,.0f}"


results = load_results()
df = pd.DataFrame(results)

st.title("Phantom Flow")
st.caption(
    "Evidence-backed triage for public funding recipients that dissolved after receiving grants or contributions. "
    "Current build uses representative cached demo data until live source validation is completed."
)

zombie_df = df[df["is_zombie_candidate"]]
high_df = df[df["priority"] == "High"]

metric_cols = st.columns(5)
metric_cols[0].metric("Entities analyzed", f"{len(df):,}")
metric_cols[1].metric("Zombie candidates", f"{len(zombie_df):,}")
metric_cols[2].metric("High priority", f"{len(high_df):,}")
metric_cols[3].metric("Total awarded", money(float(df["total_awarded"].sum())))
metric_cols[4].metric("Est. recoverable", money(float(df["estimated_recoverable"].sum())))

st.divider()

filter_cols = st.columns([1, 1, 1, 1])
priority = filter_cols[0].selectbox("Priority", ["All"] + sorted(df["priority"].unique().tolist()))
province = filter_cols[1].selectbox("Province", ["All"] + sorted(df["province"].unique().tolist()))
confidence = filter_cols[2].selectbox("Confidence", ["All"] + ["High", "Medium", "Low"])
only_zombies = filter_cols[3].toggle("Zombie candidates only", value=False)

filtered = df.copy()
if priority != "All":
    filtered = filtered[filtered["priority"] == priority]
if province != "All":
    filtered = filtered[filtered["province"] == province]
if confidence != "All":
    filtered = filtered[filtered["confidence"] == confidence]
if only_zombies:
    filtered = filtered[filtered["is_zombie_candidate"]]

queue_columns = [
    "display_name",
    "province",
    "total_awarded",
    "estimated_recoverable",
    "priority",
    "recommendation",
    "roi_score",
    "confidence",
    "months_to_dissolution",
]

st.subheader("Ranked Enforcement Queue")
st.dataframe(
    filtered.sort_values(["roi_score", "total_awarded"], ascending=False)[queue_columns],
    use_container_width=True,
    hide_index=True,
    column_config={
        "display_name": "Entity",
        "total_awarded": st.column_config.NumberColumn("Awarded", format="$%d"),
        "estimated_recoverable": st.column_config.NumberColumn("Recoverable", format="$%d"),
        "roi_score": st.column_config.ProgressColumn("ROI score", min_value=0, max_value=100),
        "months_to_dissolution": "Months to dissolution",
    },
)

if filtered.empty:
    st.info("No entities match the selected filters.")
    st.stop()

selected_name = st.selectbox(
    "Case file",
    filtered.sort_values(["roi_score", "total_awarded"], ascending=False)["display_name"].tolist(),
)
entity = next(item for item in results if item["display_name"] == selected_name)
match = entity["match"]

st.subheader(selected_name)
detail_cols = st.columns([1.1, 1, 1])
detail_cols[0].metric("Recommendation", entity["recommendation"])
detail_cols[1].metric("ROI score", f"{entity['roi_score']}/100")
detail_cols[2].metric("Evidence confidence", entity["confidence"])
st.caption(
    f"Case summary source: {entity.get('case_summary_provider', 'template')} "
    f"({entity.get('case_summary_model', 'deterministic-template')})"
)

left, right = st.columns([1.2, 1])

with left:
    st.markdown("#### AI Case Summary")
    st.write(entity["case_summary"])

    st.markdown("#### Evidence")
    st.write(
        {
            "corporate_status": match["status"],
            "corporation_number": match["corporation_number"],
            "dissolution_date": match["dissolution_date"],
            "last_award_date": entity["last_award_date"],
            "months_to_dissolution": entity["months_to_dissolution"],
            "match_confidence": match["confidence"],
        }
    )

    st.markdown("#### Grant Rows")
    st.dataframe(
        pd.DataFrame(entity["grant_evidence"])[
            ["agreement_number", "agreement_start_date", "agreement_value", "department", "program_name"]
        ],
        use_container_width=True,
        hide_index=True,
        column_config={"agreement_value": st.column_config.NumberColumn("Award", format="$%d")},
    )

with right:
    st.markdown("#### Score Breakdown")
    breakdown = pd.DataFrame(
        [
            {"component": name.replace("_", " ").title(), "points": points}
            for name, points in entity["score_breakdown"].items()
        ]
    )
    st.bar_chart(breakdown, x="component", y="points", height=260)

    st.markdown("#### Flags")
    for flag in entity["flags"]:
        st.write(f"- {flag}")

    st.markdown("#### Caveats")
    st.write("- Demo data is representative until live source validation is complete.")
    st.write("- A high score is a triage signal, not a finding of wrongdoing.")
    st.write("- Provincial-only corporations are outside the federal corporation scope.")

st.download_button(
    "Download filtered queue",
    data=filtered.to_csv(index=False),
    file_name="phantom-flow-enforcement-queue.csv",
    mime="text/csv",
)
