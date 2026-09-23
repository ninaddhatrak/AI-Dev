import { fetchStats } from "../api.js";
import { renderGraphBg } from "./NetworkGraphV1.js";

let _bgCleanup = null;

const ICONS = {
  channels: `<svg viewBox="0 0 16 16" fill="none"><rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor"/><rect x="6.5" y="5" width="3" height="10" rx="1" fill="currentColor"/><rect x="12" y="2" width="3" height="13" rx="1" fill="currentColor"/></svg>`,
  messages: `<svg viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="10" height="3" rx="1.5" fill="currentColor"/><rect x="5" y="7" width="10" height="3" rx="1.5" fill="currentColor"/><rect x="1" y="12" width="7" height="3" rx="1.5" fill="currentColor"/></svg>`,
  edges:    `<svg viewBox="0 0 16 16" fill="none"><line x1="8" y1="2.5" x2="2" y2="13" stroke="currentColor" stroke-width="1.4"/><line x1="8" y1="2.5" x2="14" y2="13" stroke="currentColor" stroke-width="1.4"/><line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="2.5" r="2" fill="currentColor"/><circle cx="2" cy="13" r="2" fill="currentColor"/><circle cx="14" cy="13" r="2" fill="currentColor"/></svg>`,
  forwarded:`<svg viewBox="0 0 16 16" fill="none"><polyline points="5,3 10,8 5,13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="10,3 15,8 10,13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  active:   `<svg viewBox="0 0 16 16" fill="none"><path d="M1 8 Q2.5 4 4 8 Q5.5 12 7 8 Q8.5 4 10 8 Q11.5 12 13 8 Q14 6 15 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  risk:     `<svg viewBox="0 0 16 16" fill="none"><path d="M8 2 L15 14 H1 Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="8" y1="7" x2="8" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="12.5" r="0.8" fill="currentColor"/></svg>`,
};

export async function renderOverview(container) {
  if (_bgCleanup) { _bgCleanup(); _bgCleanup = null; }

  container.innerHTML = `
    <canvas id="overview-bg-canvas" style="position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;opacity:0.15;z-index:0;"></canvas>
    <div class="overview-glass-wrap">${skeletonHTML()}</div>
  `;

  const bgCanvas = document.getElementById("overview-bg-canvas");
  renderGraphBg(bgCanvas).then(cleanup => { _bgCleanup = cleanup; });

  let stats;
  try {
    stats = await fetchStats();
  } catch {
    document.querySelector(".overview-glass-wrap").innerHTML =
      `<div class="empty-state">Could not reach API — is the server running?<br/><code>uvicorn api.server:app --reload</code></div>`;
    return;
  }

  const rb    = stats.risk_breakdown;
  const total = rb.high + rb.medium + rb.low + rb.unclassified || 1;
  const pct   = (v) => ((v / total) * 100).toFixed(1);

  document.querySelector(".overview-glass-wrap").innerHTML = `
    <div class="page-header">
      <h1>Overview</h1>
      <p>Aggregate statistics across all scraped Telegram channels</p>
    </div>

    <div class="kpi-grid">
      ${kpi("Total Channels",  stats.total_channels,     "#e2e8f0", ICONS.channels)}
      ${kpi("Total Messages",  stats.total_messages,     "#e2e8f0", ICONS.messages)}
      ${kpi("Network Edges",   stats.total_edges,        "#e2e8f0", ICONS.edges)}
      ${kpi("Forwarded Msgs",  stats.forwarded_messages, "#a5b4fc", ICONS.forwarded)}
      ${kpi("Active Channels", stats.active_channels,    "#86efac", ICONS.active)}
      ${kpiHero("High Risk",   rb.high)}
    </div>

    <div class="overview-bottom-grid">

      <div class="glass-card ov-donut-card">
        <div class="card-title">Risk Level Distribution</div>
        <div id="ov-donut"></div>
        <div class="donut-legend">
          ${["high","medium","low"].map(level => `
            <div class="donut-legend-row">
              <span class="risk-dot bg-${level}"></span>
              <span class="risk-${level}">${cap(level)}</span>
              <span class="donut-legend-count">${rb[level]}</span>
              <span class="donut-legend-pct">(${pct(rb[level])}%)</span>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="glass-card">
        <div class="card-title">Content Flags</div>
        <div class="hbar-list">
          ${stats.top_flags.length
            ? stats.top_flags.map(f => {
                const max  = stats.top_flags[0].count;
                const harm = /nudif|undress|nsfw/i.test(f.flag);
                return hbar(formatFlag(f.flag), f.count, max,
                  harm ? "var(--risk-high)" : "var(--accent)");
              }).join("")
            : `<div style="color:var(--muted);padding:32px 0;text-align:center">No flags found</div>`}
        </div>
      </div>

      <div class="glass-card">
        <div class="card-title">Top Mentioned Accounts</div>
        <div class="hbar-list">
          ${stats.top_mentions.length
            ? stats.top_mentions.slice(0, 8).map(m => {
                const max = stats.top_mentions[0].count;
                return hbar(m.mention, m.count, max, "var(--accent-h)");
              }).join("")
            : `<div style="color:var(--muted);padding:32px 0;text-align:center">No mentions found</div>`}
        </div>
      </div>

    </div>
  `;

  drawDonut(document.getElementById("ov-donut"), rb, total);
}

// ── KPI cards ──────────────────────────────────────────────────────────────

function kpi(label, value, color, icon) {
  return `
    <div class="glass-card kpi-card">
      <div class="kpi-label-row">
        <span class="kpi-icon">${icon}</span>
        <span class="kpi-label">${label}</span>
      </div>
      <div class="kpi-value" style="color:${color}">${fmt(value)}</div>
    </div>`;
}

function kpiHero(label, value) {
  return `
    <div class="glass-card kpi-card kpi-hero">
      <div class="kpi-label-row">
        <span class="kpi-icon">${ICONS.risk}</span>
        <span class="kpi-label">${label}</span>
      </div>
      <div class="kpi-value" style="color:var(--risk-high)">${fmt(value)}</div>
      <span class="kpi-hero-bg-icon" aria-hidden="true">${ICONS.risk}</span>
    </div>`;
}

// ── Donut chart ────────────────────────────────────────────────────────────

function drawDonut(el, rb, total) {
  const d3 = window.d3;
  if (!d3 || !el) return;

  const size = 188, outer = 74, inner = 50;

  const segments = [
    { key: "high",         value: rb.high,        color: "#ef4444" },
    { key: "medium",       value: rb.medium,       color: "#f97316" },
    { key: "low",          value: rb.low,          color: "#22c55e" },
    { key: "unclassified", value: rb.unclassified, color: "#6b7280" },
  ].filter(d => d.value > 0);

  const pie = d3.pie().sort(null).value(d => d.value);
  const arc = d3.arc().innerRadius(inner).outerRadius(outer).padAngle(0.025).cornerRadius(3);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${size} ${size}`)
    .style("width", "100%").style("max-width", `${size}px`);

  const g = svg.append("g").attr("transform", `translate(${size/2},${size/2})`);

  g.selectAll("path")
    .data(pie(segments)).join("path")
    .attr("d", arc)
    .attr("fill", d => d.data.color)
    .attr("opacity", 0.9);

  g.append("text")
    .attr("text-anchor", "middle").attr("dy", "-0.1em")
    .style("font-size", "22px").style("font-weight", "700").style("fill", "#e2e8f0")
    .text(fmt(total));

  g.append("text")
    .attr("text-anchor", "middle").attr("dy", "1.4em")
    .style("font-size", "10px").style("font-weight", "700")
    .style("letter-spacing", "0.08em").style("fill", "rgba(255,255,255,0.35)")
    .text("TOTAL");
}

// ── Horizontal bar row ─────────────────────────────────────────────────────

function hbar(label, count, max, color) {
  const w    = Math.max(4, Math.round((count / max) * 100));
  const mono = label.startsWith("@") ? "font-family:monospace;" : "";
  return `
    <div class="hbar-item">
      <div class="hbar-fill" style="width:${w}%;background:${color}"></div>
      <span class="hbar-label" style="${mono}">${esc(label)}</span>
      <span class="hbar-count" style="color:${color}">${count.toLocaleString()}</span>
    </div>`;
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function skeletonHTML() {
  return `
    <div class="page-header">
      <div class="skel" style="width:110px;height:22px;margin-bottom:8px"></div>
      <div class="skel" style="width:260px;height:13px"></div>
    </div>
    <div class="kpi-grid">
      ${[120,100,110,130,115,90].map(w => `
        <div class="glass-card kpi-card">
          <div class="skel" style="width:${w}px;height:11px;margin-bottom:12px"></div>
          <div class="skel" style="width:64px;height:28px"></div>
        </div>`).join("")}
    </div>
    <div class="overview-bottom-grid">
      <div class="glass-card ov-donut-card">
        <div class="skel" style="width:130px;height:11px;margin-bottom:16px"></div>
        <div class="skel" style="width:188px;height:188px;border-radius:50%;margin:0 auto 16px"></div>
        ${[3].fill(0).map(() => `
          <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
            <div class="skel" style="width:10px;height:10px;border-radius:50%"></div>
            <div class="skel" style="width:48px;height:11px"></div>
            <div class="skel" style="width:36px;height:11px;margin-left:auto"></div>
          </div>`).join("")}
      </div>
      ${[1,1].map(() => `
        <div class="glass-card">
          <div class="skel" style="width:100px;height:11px;margin-bottom:16px"></div>
          ${[85,65,45,55,40].map(w => `
            <div class="hbar-item" style="margin-bottom:5px">
              <div class="skel" style="width:${w}%;height:100%;position:absolute;inset:0;border-radius:7px"></div>
              <div class="skel" style="width:${w+20}px;height:13px;position:relative"></div>
              <div class="skel" style="width:36px;height:13px;position:relative"></div>
            </div>`).join("")}
        </div>`).join("")}
    </div>
  `;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : n;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatFlag(f) {
  return f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
