import { fetchGraph } from "../api.js";

const RISK_COLOR = {
  high: "#ef4444",
  medium: "#f97316",
  low: "#22c55e",
  unclassified: "#6b7280",
};

const EDGE_COLOR = {
  mention: "#818cf8",
  forward: "#f472b6",
  link: "#34d399",
};

const RECENT_COLOR = "#facc15"; // yellow ring for recently discovered nodes

export async function renderNetworkGraph(container, { onSelectChannel } = {}) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Network Graph</h1>
      <p>Force-directed graph of channels and their connections</p>
    </div>
    <div class="graph-shell">
      <div class="graph-canvas-wrap">
        <div class="graph-controls">
          <button class="btn" id="zoom-in"  title="Zoom in">+</button>
          <button class="btn" id="zoom-out" title="Zoom out">−</button>
          <button class="btn" id="zoom-fit" title="Reset view" style="font-size:12px">⊡</button>
        </div>
        <svg id="graph-svg">
          <defs>
            <style>
              @keyframes pulse-ring {
                0%   { r: 0;   opacity: 0.8; }
                100% { r: 14;  opacity: 0;   }
              }
              .recent-pulse { animation: pulse-ring 1.8s ease-out infinite; }
            </style>
          </defs>
        </svg>
      </div>
      <div class="graph-sidebar">
        <div class="card graph-legend">
          <div class="card-title">Node Risk Level</div>
          ${Object.entries(RISK_COLOR).map(([k,c]) => `
            <div class="legend-row">
              <span class="legend-circle" style="background:${c}"></span>
              <span>${k.charAt(0).toUpperCase() + k.slice(1)}</span>
            </div>`).join("")}
          <div class="legend-row">
            <span class="legend-circle" style="background:transparent;border:2px solid ${RECENT_COLOR};box-shadow:0 0 4px ${RECENT_COLOR}"></span>
            <span style="color:${RECENT_COLOR}">Recently found</span>
          </div>
          <div class="card-title" style="margin-top:12px">Edge Type</div>
          ${Object.entries(EDGE_COLOR).map(([k,c]) => `
            <div class="legend-row">
              <span class="legend-circle" style="background:${c};border-radius:2px"></span>
              <span>${k.charAt(0).toUpperCase() + k.slice(1)}</span>
            </div>`).join("")}
        </div>
        <div class="card" id="graph-filter-card">
          <div class="card-title">Filter</div>
          <div class="filter-chips" style="flex-direction:column;gap:6px;margin-top:8px">
            ${Object.entries(RISK_COLOR).map(([k]) => `
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
                <input type="checkbox" class="risk-toggle" data-risk="${k}" checked />
                ${k.charAt(0).toUpperCase() + k.slice(1)}
              </label>`).join("")}
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-top:4px;padding-top:8px;border-top:1px solid var(--border)">
              <input type="checkbox" id="recent-only-toggle" />
              <span style="color:${RECENT_COLOR}">Show recent only</span>
            </label>
          </div>
        </div>
        <div class="card node-info" id="node-info" style="display:none">
          <div class="card-title">Selected Node</div>
          <div id="node-info-body"></div>
          <button class="btn" id="node-messages-btn" style="margin-top:12px;width:100%">Browse Messages</button>
        </div>
      </div>
    </div>
  `;

  const svg = d3.select("#graph-svg");
  const wrap = document.querySelector(".graph-canvas-wrap");
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  svg.attr("viewBox", `0 0 ${W} ${H}`);

  svg.append("text")
    .attr("x", W / 2).attr("y", H / 2)
    .attr("text-anchor", "middle")
    .attr("fill", "#7a8499")
    .text("Loading graph…");

  let graphData;
  try {
    graphData = await fetchGraph();
  } catch {
    svg.selectAll("*").remove();
    svg.append("text")
      .attr("x", W / 2).attr("y", H / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#7a8499")
      .text("API error — is the server running?");
    return;
  }

  svg.selectAll("text").remove(); // clear loading text (keep defs)

  const { nodes, edges } = graphData;
  if (!nodes.length) {
    svg.append("text")
      .attr("x", W / 2).attr("y", H / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#7a8499")
      .text("No graph data available.");
    return;
  }

  const nodeById = new Map(nodes.map(n => [n.channel_id, n]));
  const validEdges = edges.filter(e =>
    nodeById.has(e.source_channel_id) && nodeById.has(e.target_channel_id)
  );

  const simNodes = nodes.map(n => ({ ...n }));
  const nodeMap = new Map(simNodes.map(n => [n.channel_id, n]));

  const simLinks = validEdges.map(e => ({
    source: nodeMap.get(e.source_channel_id),
    target: nodeMap.get(e.target_channel_id),
    edge_type: e.edge_type,
    weight: e.weight,
  }));

  const maxMembers = d3.max(simNodes, d => d.member_count || 0) || 1;
  const r = d => {
    const base = 4, max = 16;
    if (!d.member_count) return base;
    return base + (d.member_count / maxMembers) * (max - base);
  };

  const zoom = d3.zoom().scaleExtent([0.05, 8]).on("zoom", e => {
    g.attr("transform", e.transform);
  });
  svg.call(zoom);

  const g = svg.append("g");

  const link = g.append("g")
    .selectAll("line")
    .data(simLinks)
    .join("line")
    .attr("stroke", d => EDGE_COLOR[d.edge_type] || "#4b5563")
    .attr("stroke-opacity", 0.5)
    .attr("stroke-width", d => Math.sqrt(d.weight || 1));

  // Pulse rings for recently discovered nodes (drawn behind nodes)
  const recentNodes = simNodes.filter(d => d.is_recent);
  const pulseGroup = g.append("g").attr("class", "pulse-group");

  // We'll position these in the tick — store references by channel_id
  const pulseCircles = pulseGroup.selectAll("circle")
    .data(recentNodes)
    .join("circle")
    .attr("class", "recent-pulse")
    .attr("fill", "none")
    .attr("stroke", RECENT_COLOR)
    .attr("stroke-width", 1.5)
    // stagger animation so they don't all pulse in sync
    .style("animation-delay", (_, i) => `${(i * 0.12) % 1.8}s`);

  // Outer static ring for recently discovered nodes
  const recentRing = g.append("g")
    .selectAll("circle")
    .data(recentNodes)
    .join("circle")
    .attr("r", d => r(d) + 4)
    .attr("fill", "none")
    .attr("stroke", RECENT_COLOR)
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "3 2")
    .attr("pointer-events", "none");

  const node = g.append("g")
    .selectAll("circle")
    .data(simNodes)
    .join("circle")
    .attr("r", d => r(d))
    .attr("fill", d => RISK_COLOR[d.risk_level] || "#6b7280")
    .attr("stroke", "#1a1d27")
    .attr("stroke-width", 1.5)
    .attr("cursor", "pointer")
    .call(
      d3.drag()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
    );

  node.append("title").text(d =>
    `${d.title || d.channel_id}${d.is_recent ? " ★ recently discovered" : ""}\n${d.risk_level} | score: ${d.relevance_score != null ? d.relevance_score.toFixed(2) : "—"}`
  );

  // Declared here so restartSim (defined below via hoisting) can close over it
  let sim = null;

  // Initial layout — all nodes visible
  restartSim(simNodes, simLinks);

  // Click to select
  node.on("click", (event, d) => {
    event.stopPropagation();

    node
      .attr("stroke", n => n.channel_id === d.channel_id ? "#fff" : "#1a1d27")
      .attr("stroke-width", n => n.channel_id === d.channel_id ? 2.5 : 1.5)
      .attr("opacity", n => {
        const connected = simLinks.some(l =>
          (l.source.channel_id === d.channel_id && l.target.channel_id === n.channel_id) ||
          (l.target.channel_id === d.channel_id && l.source.channel_id === n.channel_id) ||
          n.channel_id === d.channel_id
        );
        return connected ? 1 : 0.2;
      });

    link.attr("opacity", l =>
      (l.source.channel_id === d.channel_id || l.target.channel_id === d.channel_id) ? 1 : 0.05
    );

    showNodeInfo(d);
  });

  svg.on("click", () => {
    node.attr("stroke", d => d.is_recent ? RECENT_COLOR : "#1a1d27")
        .attr("stroke-width", 1.5)
        .attr("opacity", 1);
    link.attr("opacity", 0.5);
    document.getElementById("node-info").style.display = "none";
  });

  // sim is re-created on each filter change so the layout recalculates
  // with only the visible nodes — otherwise hidden nodes still occupy space.

  function tick() {
    link
      .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("cx", d => d.x).attr("cy", d => d.y);
    recentRing.attr("cx", d => d.x).attr("cy", d => d.y);
    pulseCircles.attr("cx", d => d.x).attr("cy", d => d.y)
                .attr("r", d => r(d) + 2);
  }

  function restartSim(activeNodes, activeLinks) {
    if (sim) sim.stop();

    // Pin positions of nodes that are staying visible so they don't scatter
    // on each filter toggle — only truly new-to-view nodes start unanchored.
    sim = d3.forceSimulation(activeNodes)
      .force("link", d3.forceLink(activeLinks).id(d => d.channel_id).distance(60).strength(0.4))
      .force("charge", d3.forceManyBody().strength(-150))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide().radius(d => r(d) + 4))
      .alpha(0.6)
      .on("tick", tick);
  }

  // Zoom controls
  document.getElementById("zoom-in").addEventListener("click", () =>
    svg.transition().call(zoom.scaleBy, 1.4)
  );
  document.getElementById("zoom-out").addEventListener("click", () =>
    svg.transition().call(zoom.scaleBy, 0.7)
  );
  document.getElementById("zoom-fit").addEventListener("click", () =>
    svg.transition().call(zoom.transform, d3.zoomIdentity)
  );

  // Risk filter toggles + recent-only
  document.querySelectorAll(".risk-toggle").forEach(cb => {
    cb.addEventListener("change", applyFilters);
  });
  document.getElementById("recent-only-toggle").addEventListener("change", applyFilters);

  function applyFilters() {
    const hiddenRisk = new Set(
      [...document.querySelectorAll(".risk-toggle")]
        .filter(c => !c.checked)
        .map(c => c.dataset.risk)
    );
    const recentOnly = document.getElementById("recent-only-toggle").checked;

    const isVisible = d =>
      !hiddenRisk.has(d.risk_level) && !(recentOnly && !d.is_recent);

    node.attr("display", d => isVisible(d) ? null : "none");
    recentRing.attr("display", d => isVisible(d) ? null : "none");
    pulseCircles.attr("display", d => isVisible(d) ? null : "none");
    link.attr("display", l =>
      isVisible(l.source) && isVisible(l.target) ? null : "none"
    );

    // Rebuild simulation with only the visible subset so the layout
    // fills the canvas properly instead of clustering in one corner.
    const activeNodes = simNodes.filter(isVisible);
    const activeLinks = simLinks.filter(l => isVisible(l.source) && isVisible(l.target));
    restartSim(activeNodes, activeLinks);
  }

  function showNodeInfo(d) {
    const box = document.getElementById("node-info");
    box.style.display = "block";
    const flags = parseFlags(d.content_flags);
    const discoveredAt = d.discovered_at
      ? new Date(d.discovered_at).toLocaleString()
      : "—";
    document.getElementById("node-info-body").innerHTML = `
      <div class="node-info-row"><span class="node-info-label">Title</span><span>${esc(d.title)}</span></div>
      ${d.username ? `<div class="node-info-row"><span class="node-info-label">Username</span><span style="font-family:monospace">@${esc(d.username)}</span></div>` : ""}
      <div class="node-info-row"><span class="node-info-label">Risk</span><span class="risk-pill ${d.risk_level}">${d.risk_level}</span></div>
      <div class="node-info-row"><span class="node-info-label">Score</span><span>${d.relevance_score != null ? d.relevance_score.toFixed(3) : "—"}</span></div>
      <div class="node-info-row"><span class="node-info-label">Members</span><span>${d.member_count != null ? d.member_count.toLocaleString() : "—"}</span></div>
      <div class="node-info-row"><span class="node-info-label">Discovered</span><span style="font-size:11px">${discoveredAt}</span></div>
      ${d.is_recent ? `<div class="node-info-row"><span style="color:${RECENT_COLOR};font-size:12px;font-weight:600">★ Recently discovered</span></div>` : ""}
      ${flags.length ? `<div class="node-info-row"><span class="node-info-label">Flags</span><span>${flags.map(f => `<span class="flag-chip">${f}</span>`).join("")}</span></div>` : ""}
    `;
    document.getElementById("node-messages-btn").onclick = () => {
      if (onSelectChannel) onSelectChannel(d.channel_id);
    };
  }
}

function parseFlags(flags) {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  try { return JSON.parse(flags); } catch { return []; }
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
