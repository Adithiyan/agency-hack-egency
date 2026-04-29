const state = {
  rows: [],
  filtered: [],
  selectedId: null,
  sortKey: "roi_score",
};

const money = (value) => {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(number).toLocaleString()}`;
};

const compact = (value) => Number(value || 0).toLocaleString();
const byId = (id) => document.getElementById(id);

async function loadData() {
  const response = await fetch("./data/results.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load results.json: ${response.status}`);
  state.rows = await response.json();
  state.selectedId = state.rows[0]?.entity_key ?? null;
  hydrateFilters();
  applyFilters();
}

function hydrateFilters() {
  fillSelect("priorityFilter", ["All", ...unique(state.rows.map((row) => row.priority))]);
  fillSelect("provinceFilter", ["All", ...unique(state.rows.map((row) => row.province))]);
  fillSelect("confidenceFilter", ["All", "High", "Medium", "Low"]);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function fillSelect(id, values) {
  byId(id).innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join("");
}

function applyFilters() {
  const search = byId("searchInput").value.trim().toLowerCase();
  const priority = byId("priorityFilter").value;
  const province = byId("provinceFilter").value;
  const confidence = byId("confidenceFilter").value;
  const zombieOnly = byId("zombieOnly").checked;

  state.filtered = state.rows.filter((row) => {
    const haystack = [
      row.display_name,
      row.province,
      row.priority,
      row.recommendation,
      ...(row.departments || []),
      ...(row.programs || []),
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!search || haystack.includes(search)) &&
      (priority === "All" || row.priority === priority) &&
      (province === "All" || row.province === province) &&
      (confidence === "All" || row.confidence === confidence) &&
      (!zombieOnly || row.is_zombie_candidate)
    );
  });

  state.filtered.sort((a, b) => Number(b[state.sortKey] || 0) - Number(a[state.sortKey] || 0));
  if (!state.filtered.some((row) => row.entity_key === state.selectedId)) {
    state.selectedId = state.filtered[0]?.entity_key ?? null;
  }
  render();
}

function render() {
  renderMetrics();
  renderQueue();
  renderCase();
  renderCharts();
}

function renderMetrics() {
  const rows = state.rows;
  const zombies = rows.filter((row) => row.is_zombie_candidate);
  const high = rows.filter((row) => row.priority === "High");
  const totalAwarded = sum(rows, "total_awarded");
  const recoverable = sum(rows, "estimated_recoverable");
  const strict = rows.filter((row) => Number(row.months_to_dissolution) <= 12 && row.is_zombie_candidate);

  const metrics = [
    ["Entities", compact(rows.length)],
    ["Zombie Candidates", compact(zombies.length)],
    ["Strict 12-Month", compact(strict.length)],
    ["High Priority", compact(high.length)],
    ["Recoverable", money(recoverable)],
  ];
  byId("metrics").innerHTML = metrics
    .map(([label, value]) => `<article class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></article>`)
    .join("");
}

function renderQueue() {
  byId("caseCount").textContent = `${state.filtered.length.toLocaleString()} records`;
  byId("queueBody").innerHTML = state.filtered
    .map((row) => {
      const selected = row.entity_key === state.selectedId ? "selected" : "";
      return `
        <tr class="${selected}" data-id="${row.entity_key}">
          <td>
            <div class="entity-cell">
              <strong>${escapeHtml(row.display_name)}</strong>
              <span class="subtle">${escapeHtml(row.province)} · ${escapeHtml(row.recommendation)}</span>
            </div>
          </td>
          <td><span class="pill ${row.priority.toLowerCase()}">${row.priority}</span></td>
          <td>${money(row.total_awarded)}</td>
          <td>${money(row.estimated_recoverable)}</td>
          <td>
            <div class="score">
              <strong>${row.roi_score}</strong>
              <span class="score-track"><span class="score-fill" style="width:${row.roi_score}%"></span></span>
            </div>
          </td>
          <td>${row.months_to_dissolution ?? "N/A"}</td>
        </tr>`;
    })
    .join("");

  document.querySelectorAll("#queueBody tr").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.id;
      renderQueue();
      renderCase();
    });
  });
}

function renderCase() {
  const entity = state.rows.find((row) => row.entity_key === state.selectedId);
  if (!entity) {
    byId("casePanel").innerHTML = `<div class="case-body"><p>No case selected.</p></div>`;
    return;
  }

  const match = entity.match || {};
  const breakdown = entity.score_breakdown || {};
  const grants = entity.grant_evidence || [];
  byId("casePanel").innerHTML = `
    <div class="panel-header">
      <div class="case-title">
        <h3>${escapeHtml(entity.display_name)}</h3>
        <p>${escapeHtml(entity.province)} · ${escapeHtml(match.status || "Unmatched")}</p>
      </div>
    </div>
    <div class="case-body">
      <div class="fact-grid">
        <div class="fact"><span>Recommendation</span><strong>${escapeHtml(entity.recommendation)}</strong></div>
        <div class="fact"><span>Confidence</span><strong>${escapeHtml(entity.confidence)}</strong></div>
        <div class="fact"><span>Awarded</span><strong>${money(entity.total_awarded)}</strong></div>
        <div class="fact"><span>Recoverable</span><strong>${money(entity.estimated_recoverable)}</strong></div>
        <div class="fact"><span>Summary Source</span><strong>${escapeHtml(entity.case_summary_provider || "template")}</strong></div>
        <div class="fact"><span>Model</span><strong>${escapeHtml(entity.case_summary_model || "deterministic-template")}</strong></div>
      </div>

      <section>
        <h4>Case Summary</h4>
        <p class="case-summary">${escapeHtml(entity.case_summary)}</p>
      </section>

      <section>
        <h4>Timeline</h4>
        <div class="timeline">
          <div class="timeline-item"><span class="dot"></span><div><strong>First award</strong><p class="subtle">${entity.first_award_date}</p></div></div>
          <div class="timeline-item"><span class="dot"></span><div><strong>Last award</strong><p class="subtle">${entity.last_award_date}</p></div></div>
          <div class="timeline-item"><span class="dot"></span><div><strong>Corporate status</strong><p class="subtle">${escapeHtml(match.status || "Unknown")} ${match.dissolution_date ? `on ${match.dissolution_date}` : ""}</p></div></div>
        </div>
      </section>

      <section>
        <h4>Score Breakdown</h4>
        <div class="evidence-list">
          ${Object.entries(breakdown)
            .map(([name, points]) => `<div class="evidence-row"><strong>${title(name)}</strong><p class="subtle">${points} points</p></div>`)
            .join("")}
        </div>
      </section>

      <section>
        <h4>Flags</h4>
        <div class="flag-list">${(entity.flags || []).map((flag) => `<div class="flag-row">${escapeHtml(flag)}</div>`).join("")}</div>
      </section>

      <section>
        <h4>Grant Evidence</h4>
        <div class="evidence-list">
          ${grants
            .slice(0, 4)
            .map(
              (grant) => `
              <div class="evidence-row">
                <strong>${escapeHtml(grant.agreement_number)} · ${money(grant.agreement_value)}</strong>
                <p class="subtle">${grant.agreement_start_date} · ${escapeHtml(grant.department)}</p>
              </div>`
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderCharts() {
  renderBarChart("priorityChart", countBy(state.rows, "priority"), (value) => `${value} cases`);
  renderBarChart("provinceChart", sumBy(state.rows, "province", "total_awarded"), money);
}

function renderBarChart(id, data, formatter) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  byId(id).innerHTML = entries
    .map(
      ([label, value]) => `
      <div class="bar-row">
        <span>${escapeHtml(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(value / max) * 100}%"></span></span>
        <strong>${formatter(value)}</strong>
      </div>`
    )
    .join("");
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1;
    return acc;
  }, {});
}

function sumBy(rows, key, valueKey) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + Number(row[valueKey] || 0);
    return acc;
  }, {});
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function title(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function exportCsv() {
  const columns = ["display_name", "province", "priority", "recommendation", "roi_score", "total_awarded", "estimated_recoverable", "confidence", "months_to_dissolution"];
  const lines = [columns.join(",")];
  state.filtered.forEach((row) => {
    lines.push(columns.map((column) => `"${String(row[column] ?? "").replaceAll('"', '""')}"`).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "phantom-flow-queue.csv";
  link.click();
  URL.revokeObjectURL(url);
}

["searchInput", "priorityFilter", "provinceFilter", "confidenceFilter", "zombieOnly"].forEach((id) => {
  byId(id).addEventListener("input", applyFilters);
});

document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.sortKey = button.dataset.sort;
    applyFilters();
  });
});

byId("exportBtn").addEventListener("click", exportCsv);
byId("refreshBtn").addEventListener("click", () => loadData().catch(showError));

function showError(error) {
  document.body.innerHTML = `<main class="error"><h1>Could not load Phantom Flow</h1><p>${escapeHtml(error.message)}</p></main>`;
}

loadData().catch(showError);
