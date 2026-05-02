import { fetchStats } from "../api.js";

const RISK_COLORS = {
  high: "var(--risk-high)",
  medium: "var(--risk-medium)",
  low: "var(--risk-low)",
  unclassified: "var(--risk-unclassified)",
};

export async function renderOverview(container) {
  container.innerHTML = `<div class="loading"><div class="loading-spinner"></div>Loading stats…</div>`;
  let stats;
  try {
    stats = await fetchStats();
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Could not reach API — is the server running?<br/><code>uvicorn api.server:app --reload</code></div>`;
    return;
  }

  const rb = stats.risk_breakdown;
  const total = rb.high + rb.medium + rb.low + rb.unclassified || 1;

  const pct = (v) => ((v / total) * 100).toFixed(1);

  container.innerHTML = `
    <div class="page-header">
      <h1>Overview</h1>
      <p>Aggregate statistics across all scraped Telegram channels</p>
    </div>

    <div class="kpi-grid">
      ${kpi("Total Channels",  stats.total_channels,    "#e2e8f0")}
      ${kpi("Total Messages",  stats.total_messages,    "#e2e8f0")}
      ${kpi("Network Edges",   stats.total_edges,       "#e2e8f0")}
      ${kpi("Forwarded Msgs",  stats.forwarded_messages,"#a5b4fc")}
      ${kpi("Active Channels", stats.active_channels,   "#86efac")}
      ${kpi("High Risk",       rb.high,                 "var(--risk-high)")}
    </div>

    <div class="card risk-bar-wrap" style="margin-bottom:24px">
      <div class="card-title">Risk Level Distribution</div>
      <div class="risk-bar-track">
        ${Object.entries(rb).map(([level, count]) =>
          `<div class="risk-bar-seg bg-${level}" style="width:${pct(count)}%" title="${level}: ${count}"></div>`
        ).join("")}
      </div>
      <div class="risk-legend">
        ${Object.entries(rb).map(([level, count]) => `
          <span>
            <span class="risk-dot bg-${level}"></span>
            <span class="risk-${level}">${cap(level)}</span>
            <span style="color:var(--muted);margin-left:4px;">${count} (${pct(count)}%)</span>
          </span>
        `).join("")}
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">Content Flags</div>
        <ul class="flag-list">
          ${stats.top_flags.length
            ? stats.top_flags.map(f => `
                <li>
                  <span>${formatFlag(f.flag)}</span>
                  <span class="badge">${f.count}</span>
                </li>`).join("")
            : `<li style="color:var(--muted)">No flags found</li>`}
        </ul>
      </div>

      <div class="card">
        <div class="card-title">Top Mentioned Accounts</div>
        <ul class="mention-list">
          ${stats.top_mentions.length
            ? stats.top_mentions.slice(0, 8).map(m => `
                <li>
                  <span style="font-family:monospace">${m.mention}</span>
                  <span class="badge">${m.count}</span>
                </li>`).join("")
            : `<li style="color:var(--muted)">No mentions found</li>`}
        </ul>
      </div>
    </div>
  `;
}

function kpi(label, value, color) {
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value" style="color:${color}">${fmt(value)}</div>
    </div>`;
}

function fmt(n) {
  if (n == null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : n;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatFlag(f) {
  return f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
