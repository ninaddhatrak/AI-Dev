import { fetchStats, fetchChannels } from "../api.js";

const ICONS = {
  channels: `<svg viewBox="0 0 16 16" fill="none"><rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor"/><rect x="6.5" y="5" width="3" height="10" rx="1" fill="currentColor"/><rect x="12" y="2" width="3" height="13" rx="1" fill="currentColor"/></svg>`,
  messages: `<svg viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="10" height="3" rx="1.5" fill="currentColor"/><rect x="5" y="7" width="10" height="3" rx="1.5" fill="currentColor"/><rect x="1" y="12" width="7" height="3" rx="1.5" fill="currentColor"/></svg>`,
  edges:    `<svg viewBox="0 0 16 16" fill="none"><line x1="8" y1="2.5" x2="2"  y2="13" stroke="currentColor" stroke-width="1.4"/><line x1="8" y1="2.5" x2="14" y2="13" stroke="currentColor" stroke-width="1.4"/><line x1="2"  y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.4"/><circle cx="8"  cy="2.5" r="2" fill="currentColor"/><circle cx="2"  cy="13"  r="2" fill="currentColor"/><circle cx="14" cy="13"  r="2" fill="currentColor"/></svg>`,
  forwarded:`<svg viewBox="0 0 16 16" fill="none"><polyline points="5,3 10,8 5,13"  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="10,3 15,8 10,13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  active:   `<svg viewBox="0 0 16 16" fill="none"><path d="M1 8 Q2.5 4 4 8 Q5.5 12 7 8 Q8.5 4 10 8 Q11.5 12 13 8 Q14 6 15 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  risk:     `<svg viewBox="0 0 16 16" fill="none"><path d="M8 2 L15 14 H1 Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="8" y1="7" x2="8" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="12.5" r="0.8" fill="currentColor"/></svg>`,
};

export async function renderOverview(container) {
  container.innerHTML = `<div class="overview-wrap">${skeletonHTML()}</div>`;

  const [statsResult, channelsResult] = await Promise.allSettled([
    fetchStats(),
    fetchChannels({ limit: 500 }),
  ]);

  if (statsResult.status === "rejected") {
    container.querySelector(".overview-wrap").innerHTML = `
      <div class="empty-state">
        Could not reach API — is the server running?<br/>
        <code style="font-size:12px;color:var(--muted)">uvicorn api.server:app --reload</code>
      </div>`;
    return;
  }

  const stats    = statsResult.value;
  const channels = channelsResult.status === "fulfilled"
    ? (channelsResult.value.channels || [])
    : [];

  const rb    = stats.risk_breakdown;
  const total = (rb.high + rb.medium + rb.low + rb.unclassified) || 1;
  const pct   = (v) => ((v / total) * 100).toFixed(1);

  container.querySelector(".overview-wrap").innerHTML = `
    <div class="page-header">
      <h1>Overview</h1>
      <p>Aggregate statistics across all scraped Telegram channels</p>
    </div>

    <div class="kpi-grid">
      ${kpi("Total Channels",  stats.total_channels,     "var(--text)",      ICONS.channels)}
      ${kpi("Total Messages",  stats.total_messages,     "var(--text)",      ICONS.messages)}
      ${kpi("Network Edges",   stats.total_edges,        "var(--text)",      ICONS.edges)}
      ${kpi("Forwarded Msgs",  stats.forwarded_messages, "var(--accent-h)",  ICONS.forwarded)}
      ${kpi("Active Channels", stats.active_channels,    "var(--risk-low)",  ICONS.active)}
      ${kpiHero("High Risk",   rb.high)}
    </div>

    <div class="overview-bottom-grid">

      <div class="card" style="display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px">
          <div class="card-title" style="margin-bottom:0">Discovery Timeline</div>
          <span id="ov-chart-range" style="font-size:11px;color:var(--muted)"></span>
        </div>
        <div id="ov-chart" style="flex:1;min-height:178px"></div>
        <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
          ${["high","medium","low"].map((level) => `
            <div style="display:flex;align-items:center;gap:6px;font-size:12px">
              <span style="width:8px;height:8px;border-radius:50%;background:var(--risk-${level});flex-shrink:0"></span>
              <span class="risk-${level}">${cap(level)}</span>
              <span style="color:var(--muted)">${rb[level].toLocaleString()} (${pct(rb[level])}%)</span>
            </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Content Flags</div>
        <div class="hbar-list">
          ${stats.top_flags.length
            ? stats.top_flags.map((f) => {
                const max  = stats.top_flags[0].count;
                const harm = /nudif|undress|nsfw/i.test(f.flag);
                return hbar(formatFlag(f.flag), f.count, max,
                  harm ? "var(--risk-high)" : "var(--accent)");
              }).join("")
            : `<div style="color:var(--muted);padding:32px 0;text-align:center">No flags found</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Top Mentioned Accounts</div>
        <div class="hbar-list">
          ${stats.top_mentions.length
            ? stats.top_mentions.slice(0, 8).map((m) => {
                const max = stats.top_mentions[0].count;
                return hbar(m.mention, m.count, max, "var(--accent-h)");
              }).join("")
            : `<div style="color:var(--muted);padding:32px 0;text-align:center">No mentions found</div>`}
        </div>
      </div>

    </div>
  `;

  drawDiscoveryChart(
    document.getElementById("ov-chart"),
    document.getElementById("ov-chart-range"),
    channels,
  );
}

/* ── KPI cards ─────────────────────────────────────────────── */
function kpi(label, value, color, icon) {
  return `
    <div class="card kpi-card">
      <div class="kpi-label-row">
        <span class="kpi-icon">${icon}</span>
        <span class="kpi-label">${label}</span>
      </div>
      <div class="kpi-value" style="color:${color}">${fmt(value)}</div>
    </div>`;
}

function kpiHero(label, value) {
  return `
    <div class="card kpi-card kpi-hero">
      <div class="kpi-label-row">
        <span class="kpi-icon">${ICONS.risk}</span>
        <span class="kpi-label">${label}</span>
      </div>
      <div class="kpi-value" style="color:var(--risk-high)">${fmt(value)}</div>
      <span class="kpi-hero-bg-icon" aria-hidden="true">${ICONS.risk}</span>
    </div>`;
}

/* ── Discovery area chart (D3) ──────────────────────────────── */
function drawDiscoveryChart(el, rangeEl, channels) {
  const d3 = window.d3;
  if (!d3 || !el) return;

  // Build monthly buckets
  const byMonth = {};
  for (const ch of channels) {
    const raw = ch.discovered_at || ch.last_seen;
    if (!raw) continue;
    const d = new Date(raw);
    if (isNaN(d)) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  }

  const data = Object.entries(byMonth)
    .map(([k, count]) => ({ date: new Date(k + "-01T00:00:00"), count }))
    .sort((a, b) => a.date - b.date);

  if (!data.length) {
    el.innerHTML = `<div style="color:var(--muted);text-align:center;padding:40px 0;font-size:13px">No discovery date data available</div>`;
    return;
  }

  if (rangeEl && data.length >= 2) {
    const fmtLabel = d3.timeFormat("%b %Y");
    rangeEl.textContent = `${fmtLabel(data[0].date)} – ${fmtLabel(data[data.length - 1].date)}`;
  }

  const W  = el.clientWidth  || 300;
  const H  = 178;
  const mg = { top: 8, right: 14, bottom: 30, left: 38 };
  const iW = W - mg.left - mg.right;
  const iH = H - mg.top  - mg.bottom;

  const xScale = d3.scaleTime()
    .domain(d3.extent(data, (d) => d.date))
    .range([0, iW]);

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(data, (d) => d.count)])
    .range([iH, 0])
    .nice();

  const area = d3.area()
    .x((d) => xScale(d.date))
    .y0(iH)
    .y1((d) => yScale(d.count))
    .curve(d3.curveMonotoneX);

  const line = d3.line()
    .x((d) => xScale(d.date))
    .y((d) => yScale(d.count))
    .curve(d3.curveMonotoneX);

  const svg = d3.select(el).append("svg")
    .attr("width",  W)
    .attr("height", H)
    .style("overflow", "visible");

  const gradId = "ov-area-grad";
  svg.append("defs").append("linearGradient")
    .attr("id", gradId)
    .attr("gradientUnits", "userSpaceOnUse")
    .attr("x1", 0).attr("y1", mg.top)
    .attr("x2", 0).attr("y2", mg.top + iH)
    .call((g) => {
      g.append("stop").attr("offset", "0%")
        .attr("stop-color", "#818cf8").attr("stop-opacity", 0.28);
      g.append("stop").attr("offset", "100%")
        .attr("stop-color", "#818cf8").attr("stop-opacity", 0.0);
    });

  const g = svg.append("g").attr("transform", `translate(${mg.left},${mg.top})`);

  // Grid
  g.append("g")
    .call(d3.axisLeft(yScale).ticks(4).tickSize(-iW).tickFormat(""))
    .call((ax) => ax.select(".domain").remove())
    .call((ax) => ax.selectAll("line").attr("stroke", "#1c2030").attr("stroke-dasharray", "3,4"));

  // Area + line
  g.append("path").datum(data).attr("fill", `url(#${gradId})`).attr("d", area);
  g.append("path").datum(data).attr("fill", "none")
    .attr("stroke", "#818cf8").attr("stroke-width", 1.8).attr("d", line);

  // Dots (only when months are few)
  if (data.length <= 24) {
    g.selectAll("circle.dot").data(data).join("circle")
      .attr("class", "dot")
      .attr("cx", (d) => xScale(d.date))
      .attr("cy", (d) => yScale(d.count))
      .attr("r",  3)
      .attr("fill",   "#818cf8")
      .attr("stroke", "#151821")
      .attr("stroke-width", 1.5);
  }

  // X axis
  g.append("g")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).ticks(Math.min(data.length, W < 320 ? 4 : 7))
      .tickFormat(d3.timeFormat(data.length > 18 ? "%b '%y" : "%b %Y")))
    .call((ax) => ax.select(".domain").remove())
    .call((ax) => ax.selectAll("line").attr("stroke", "#252a3d"))
    .call((ax) => ax.selectAll("text").attr("fill", "#6b7290").attr("font-size", "10px"));

  // Y axis
  g.append("g")
    .call(d3.axisLeft(yScale).ticks(4).tickFormat(d3.format(".0f")))
    .call((ax) => ax.select(".domain").remove())
    .call((ax) => ax.selectAll("line").attr("stroke", "#252a3d"))
    .call((ax) => ax.selectAll("text").attr("fill", "#6b7290").attr("font-size", "10px"));

  // Hover
  d3.select(el).style("position", "relative");
  const bisect = d3.bisector((d) => d.date).left;

  const tip = d3.select(el).append("div")
    .style("position",       "absolute")
    .style("pointer-events", "none")
    .style("display",        "none")
    .style("background",     "var(--surface2)")
    .style("border",         "1px solid var(--border-hi)")
    .style("border-radius",  "6px")
    .style("padding",        "6px 10px")
    .style("font-size",      "12px")
    .style("color",          "var(--text)")
    .style("white-space",    "nowrap")
    .style("z-index",        "10");

  const hLine = g.append("line")
    .attr("stroke", "#818cf8").attr("stroke-width", 1)
    .attr("stroke-dasharray", "3,3")
    .attr("y1", 0).attr("y2", iH).style("display", "none");

  const hDot = g.append("circle")
    .attr("r", 4).attr("fill", "#818cf8")
    .attr("stroke", "#151821").attr("stroke-width", 2)
    .style("display", "none");

  svg.append("rect")
    .attr("width", W).attr("height", H)
    .attr("fill", "transparent").style("cursor", "crosshair")
    .on("mousemove", function (event) {
      const [mx]  = d3.pointer(event, this);
      const xVal  = xScale.invert(mx - mg.left);
      const idx   = bisect(data, xVal, 1);
      const d0    = data[idx - 1];
      const d1    = data[idx];
      const d     = d1 && xVal - d0.date > d1.date - xVal ? d1 : d0;
      if (!d) return;

      hLine.attr("x1", xScale(d.date)).attr("x2", xScale(d.date)).style("display", null);
      hDot.attr("cx",  xScale(d.date)).attr("cy",  yScale(d.count)).style("display", null);

      tip.style("display", "block")
        .style("left", `${xScale(d.date) + mg.left + 12}px`)
        .style("top",  `${yScale(d.count) + mg.top  - 10}px`)
        .html(`<strong style="color:var(--accent-h)">${d3.timeFormat("%B %Y")(d.date)}</strong><br>${d.count} new channel${d.count !== 1 ? "s" : ""}`);
    })
    .on("mouseleave", () => {
      hLine.style("display", "none");
      hDot.style("display",  "none");
      tip.style("display",   "none");
    });
}

/* ── Horizontal bar ──────────────────────────────────────────  */
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

/* ── Skeleton ────────────────────────────────────────────────  */
function skeletonHTML() {
  return `
    <div class="page-header">
      <div class="skel" style="width:110px;height:22px;margin-bottom:8px"></div>
      <div class="skel" style="width:260px;height:13px"></div>
    </div>
    <div class="kpi-grid">
      ${[120,100,110,130,115,90].map((w) => `
        <div class="card kpi-card">
          <div class="skel" style="width:${w}px;height:11px;margin-bottom:14px"></div>
          <div class="skel" style="width:64px;height:28px"></div>
        </div>`).join("")}
    </div>
    <div class="overview-bottom-grid">
      <div class="card">
        <div class="skel" style="width:150px;height:11px;margin-bottom:16px"></div>
        <div class="skel" style="width:100%;height:178px;border-radius:6px"></div>
        <div style="display:flex;gap:16px;margin-top:12px">
          ${[70,80,60].map((w) => `<div class="skel" style="width:${w}px;height:11px"></div>`).join("")}
        </div>
      </div>
      ${[1,1].map(() => `
        <div class="card">
          <div class="skel" style="width:100px;height:11px;margin-bottom:16px"></div>
          ${[85,65,45,55,40].map((w) => `
            <div class="hbar-item" style="margin-bottom:5px">
              <div class="skel" style="width:${w}%;height:100%;position:absolute;inset:0;border-radius:8px"></div>
              <div class="skel" style="width:${w+20}px;height:13px;position:relative"></div>
              <div class="skel" style="width:36px;height:13px;position:relative"></div>
            </div>`).join("")}
        </div>`).join("")}
    </div>`;
}

/* ── Utilities ───────────────────────────────────────────────  */
function fmt(n) {
  if (n == null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatFlag(f) { return f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
