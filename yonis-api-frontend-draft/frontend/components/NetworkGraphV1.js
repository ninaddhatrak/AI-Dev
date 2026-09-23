import { fetchGraph } from "../api.js";

const RISK_COLOR = {
  high:         "#ef4444",
  medium:       "#f97316",
  low:          "#22c55e",
  unclassified: "#6b7280",
};

const EDGE_COLOR = {
  mention: "#818cf8",
  forward: "#ff44cc",
  link:    "#34d399",
};

const EDGE_ALPHA = {
  mention: 0.30,
  forward: 0.12,
  link:    0.30,
};

const RECENT_COLOR = "#facc15";

export async function renderNetworkGraphV1(container, { onSelectChannel } = {}) {
  container.innerHTML = `
    <div class="graph-shell graph-shell--v1">
      <div class="graph-canvas-wrap" id="v1-wrap">

        <canvas id="v1-canvas" style="display:block;width:100%;height:100%;cursor:grab"></canvas>
        <div id="v1-tooltip" class="graph-tooltip" style="display:none"></div>

        <!-- Zoom controls — top-left -->
        <div class="graph-controls v1-zoom-controls">
          <button class="glass-btn" id="v1-zoom-in"  title="Zoom in">+</button>
          <button class="glass-btn" id="v1-zoom-out" title="Zoom out">−</button>
          <button class="glass-btn" id="v1-zoom-fit" title="Reset zoom" style="font-size:11px">⊡</button>
        </div>

        <!-- Status badge — bottom-left -->
        <div id="v1-status" class="glass-badge v1-status-badge">Loading…</div>

        <!-- Legend + filter — top-right glass panel -->
        <div class="glass-panel v1-panel-right">
          <div class="glass-panel-title">Risk Level</div>
          ${Object.entries(RISK_COLOR).map(([k, c]) => `
            <div class="legend-row">
              <span class="legend-circle" style="background:${c}"></span>
              <span>${k.charAt(0).toUpperCase() + k.slice(1)}</span>
            </div>`).join("")}
          <div class="legend-row">
            <span class="legend-circle" style="background:transparent;border:2px solid ${RECENT_COLOR}"></span>
            <span style="color:${RECENT_COLOR}">Recently found</span>
          </div>

          <div class="glass-sep"></div>
          <div class="glass-panel-title">Edge Type</div>
          ${Object.entries(EDGE_COLOR).map(([k, c]) => `
            <div class="legend-row">
              <span class="legend-circle" style="background:${c};border-radius:2px"></span>
              <span>${k.charAt(0).toUpperCase() + k.slice(1)}</span>
            </div>`).join("")}

          <div class="glass-sep"></div>
          <div class="glass-panel-title">Filter</div>
          ${Object.entries(RISK_COLOR).map(([k]) => `
            <label class="glass-check">
              <input type="checkbox" class="v1-risk-toggle" data-risk="${k}" checked />
              ${k.charAt(0).toUpperCase() + k.slice(1)}
            </label>`).join("")}
          <label class="glass-check" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.07)">
            <input type="checkbox" id="v1-recent-only" />
            <span style="color:${RECENT_COLOR}">Recent only</span>
          </label>

          <div class="glass-sep"></div>
          <div class="glass-panel-title">Min edge weight: <span id="v1-weight-label">1</span></div>
          <input type="range" id="v1-weight-slider" min="1" max="20" value="1"
                 style="width:100%;accent-color:var(--accent);margin-top:4px" />
        </div>

        <!-- Node info — bottom-right glass panel, shown on click -->
        <div class="glass-panel v1-panel-info" id="v1-node-info" style="display:none">
          <div class="glass-panel-title">Selected Node</div>
          <div id="v1-node-info-body"></div>
          <button class="glass-btn" id="v1-messages-btn" style="margin-top:10px;width:100%;font-size:12px;padding:6px 10px">Browse Messages</button>
        </div>

      </div>
    </div>
  `;

  // ── Canvas setup ─────────────────────────────────────────────────────────
  const wrap   = document.getElementById("v1-wrap");
  const canvas = document.getElementById("v1-canvas");
  const tooltip = document.getElementById("v1-tooltip");
  const statusEl = document.getElementById("v1-status");

  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  statusEl.textContent = "Fetching graph data…";
  let graphData;
  try {
    graphData = await fetchGraph();
  } catch {
    statusEl.textContent = "API error — is the server running?";
    return;
  }

  const { nodes, edges } = graphData;

  // ── Build sim data ────────────────────────────────────────────────────────
  const nodeById = new Map(nodes.map(n => [n.channel_id, n]));
  const validEdges = edges.filter(e =>
    nodeById.has(e.source_channel_id) && nodeById.has(e.target_channel_id)
  );

  const simNodes = nodes.map(n => ({ ...n }));
  const nodeMap  = new Map(simNodes.map(n => [n.channel_id, n]));

  const simLinks = validEdges.map(e => ({
    source:    nodeMap.get(e.source_channel_id),
    target:    nodeMap.get(e.target_channel_id),
    edge_type: e.edge_type,
    weight:    e.weight,
  }));

  // Pre-build adjacency for O(1) neighbor lookup on click
  const neighbors = new Map(simNodes.map(n => [n.channel_id, new Set()]));
  for (const l of simLinks) {
    neighbors.get(l.source.channel_id)?.add(l.target.channel_id);
    neighbors.get(l.target.channel_id)?.add(l.source.channel_id);
  }

  const maxMembers = Math.max(...simNodes.map(n => n.member_count || 0), 1);
  const nodeR = n => {
    const base = 3, top = 14;
    if (!n.member_count) return base;
    return base + (n.member_count / maxMembers) * (top - base);
  };

  // ── Filter / interaction state ────────────────────────────────────────────
  let hiddenRisk   = new Set();      // all visible by default — user asked for "show all"
  let recentOnly   = false;
  let minWeight    = 1;
  let selectedNode = null;
  let hoveredNode  = null;

  const isVisible = n =>
    !hiddenRisk.has(n.risk_level) && !(recentOnly && !n.is_recent);

  // ── Zoom / pan ────────────────────────────────────────────────────────────
  const INITIAL_SCALE = 0.18;
  let transform = d3.zoomIdentity
    .translate(W / 2 * (1 - INITIAL_SCALE), H / 2 * (1 - INITIAL_SCALE))
    .scale(INITIAL_SCALE);
  const zoom = d3.zoom()
    .scaleExtent([0.02, 16])
    .on("zoom", e => {
      transform = e.transform;
      draw();
    });
  d3.select(canvas).call(zoom);
  d3.select(canvas).call(zoom.transform, transform);

  // ── Simulation ────────────────────────────────────────────────────────────
  let sim;
  let tickN = 0;

  function buildSim(activeNodes, activeLinks) {
    if (sim) sim.stop();
    tickN = 0;
    sim = d3.forceSimulation(activeNodes)
      .force("link",    d3.forceLink(activeLinks)
                          .id(d => d.channel_id)
                          .distance(50)
                          .strength(0.5))
      .force("charge",  d3.forceManyBody().strength(-90).theta(0.9))
      .force("center",  d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide().radius(d => nodeR(d) + 2).iterations(1))
      .alphaDecay(0.04)      // ~115 ticks vs default ~300
      .velocityDecay(0.4)
      .on("tick", () => {
        tickN++;
        if (tickN % 3 === 0) draw();   // throttle to every 3rd tick
      })
      .on("end", () => {
        updateStatus();
        draw();
      });
  }

  function updateStatus() {
    const vn = simNodes.filter(isVisible).length;
    const ve = simLinks.filter(l =>
      l.weight >= minWeight && isVisible(l.source) && isVisible(l.target)
    ).length;
    statusEl.textContent = `${vn.toLocaleString()} nodes · ${ve.toLocaleString()} edges`;
  }

  // ── Initial run ───────────────────────────────────────────────────────────
  statusEl.textContent = `${nodes.length.toLocaleString()} nodes · simulating…`;
  buildSim(simNodes, simLinks);

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const scale   = transform.k;
    const selId   = selectedNode?.channel_id ?? null;
    const selNbrs = selId ? neighbors.get(selId) : null;
    const hasSel  = selId !== null;

    // ── Edges ──────────────────────────────────────────────────────────────
    // Group by type to minimise strokeStyle changes
    const groups = {};
    for (const l of simLinks) {
      if (l.weight < minWeight) continue;
      if (!isVisible(l.source) || !isVisible(l.target)) continue;
      if (hasSel) {
        if (l.source.channel_id !== selId && l.target.channel_id !== selId) continue;
      }
      (groups[l.edge_type] ??= []).push(l);
    }

    if (!hasSel) {
      // Non-forward edges: batched stroke (fast, no blending needed)
      for (const [type, links] of Object.entries(groups)) {
        if (type === "forward") continue;
        ctx.beginPath();
        ctx.strokeStyle = EDGE_COLOR[type] || "#4b5563";
        ctx.lineWidth   = Math.max(0.5, 1 / scale);
        ctx.globalAlpha = EDGE_ALPHA[type] ?? 0.25;
        for (const l of links) {
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
        }
        ctx.stroke();
      }
      // Forward edges: one stroke() per line so "lighter" accumulates at crossings
      if (groups.forward) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = EDGE_COLOR.forward;
        ctx.lineWidth   = Math.max(0.5, 1 / scale);
        ctx.globalAlpha = EDGE_ALPHA.forward ?? 0.12;
        for (const l of groups.forward) {
          ctx.beginPath();
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
    } else {
      // Dim non-adjacent edges
      ctx.globalAlpha = 0.04;
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth   = Math.max(0.5, 1 / scale);
      ctx.beginPath();
      for (const l of simLinks) {
        if (l.weight < minWeight) continue;
        if (!isVisible(l.source) || !isVisible(l.target)) continue;
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
      }
      ctx.stroke();

      // Highlight adjacent edges; forward gets per-line additive blending
      for (const [type, links] of Object.entries(groups)) {
        if (type === "forward") continue;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.strokeStyle = EDGE_COLOR[type] || "#4b5563";
        ctx.lineWidth   = Math.max(1, 1.5 / scale);
        for (const l of links) {
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
        }
        ctx.stroke();
      }
      if (groups.forward) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = EDGE_COLOR.forward;
        ctx.lineWidth   = Math.max(1, 1.5 / scale);
        for (const l of groups.forward) {
          ctx.beginPath();
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // ── Nodes ──────────────────────────────────────────────────────────────
    for (const n of simNodes) {
      if (!isVisible(n)) continue;

      const r        = nodeR(n);
      const isSelNode = n.channel_id === selId;
      const isNbr    = selNbrs?.has(n.channel_id) ?? false;
      const dimmed   = hasSel && !isSelNode && !isNbr;

      ctx.globalAlpha = dimmed ? 0.1 : 1;

      // Recent ring
      if (n.is_recent) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3.5 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = RECENT_COLOR;
        ctx.lineWidth   = 1.5 / scale;
        ctx.globalAlpha = dimmed ? 0.04 : 0.65;
        ctx.stroke();
        ctx.globalAlpha = dimmed ? 0.1 : 1;
      }

      // Fill
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = RISK_COLOR[n.risk_level] || "#6b7280";
      ctx.fill();

      // Selection ring
      if (isSelNode) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2.5 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth   = 2 / scale;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }

      // Labels for HIGH nodes at high zoom
      if (scale > 2.5 && n.risk_level === "high" && n.title) {
        ctx.globalAlpha = dimmed ? 0.1 : 0.9;
        ctx.fillStyle   = "#e2e8f0";
        ctx.font        = `${Math.round(9 / scale)}px Inter, system-ui, sans-serif`;
        ctx.textAlign   = "center";
        ctx.fillText(n.title.slice(0, 24), n.x, n.y + r + 9 / scale);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Hit test (canvas coords → nearest node) ───────────────────────────────
  function nodeAt(cx, cy) {
    const sx = (cx - transform.x) / transform.k;
    const sy = (cy - transform.y) / transform.k;
    for (const n of simNodes) {
      if (!isVisible(n)) continue;
      const r = nodeR(n) + 4;
      if ((n.x - sx) ** 2 + (n.y - sy) ** 2 <= r * r) return n;
    }
    return null;
  }

  // ── Mouse: tooltip on hover ───────────────────────────────────────────────
  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = nodeAt(mx, my);

    if (hit !== hoveredNode) {
      hoveredNode = hit;
      draw();
    }

    if (hit) {
      canvas.style.cursor = "pointer";
      const flags = parseFlags(hit.content_flags);
      tooltip.innerHTML = `
        <strong>${esc(hit.title || hit.channel_id)}</strong><br>
        <span style="color:${RISK_COLOR[hit.risk_level]}">${hit.risk_level}</span>
        ${hit.relevance_score != null ? ` · score ${hit.relevance_score.toFixed(2)}` : ""}
        ${hit.member_count ? `<br><span style="color:var(--muted)">${hit.member_count.toLocaleString()} members</span>` : ""}
        ${flags.length ? `<br><span style="color:var(--muted)">${flags.slice(0, 3).join(", ")}</span>` : ""}
        ${hit.is_recent ? `<br><span style="color:${RECENT_COLOR}">★ recently discovered</span>` : ""}
      `;
      tooltip.style.display = "block";
      // Keep tooltip inside the wrap
      const tw = 220, th = 80;
      tooltip.style.left = (mx + 14 + tw > W ? mx - tw - 6 : mx + 14) + "px";
      tooltip.style.top  = (my - 10 + th > H ? my - th : my - 10) + "px";
    } else {
      canvas.style.cursor = "grab";
      tooltip.style.display = "none";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    hoveredNode = null;
    canvas.style.cursor = "grab";
  });

  // ── Click to select ───────────────────────────────────────────────────────
  // d3.zoom calls stopImmediatePropagation on mousedown, which breaks native
  // mousedown/mouseup-based click detection. Use d3's own click event instead:
  // after a pan d3.zoom adds a capture-phase suppressor so the click never
  // fires; after a genuine click it passes through normally.
  d3.select(canvas).on("click.select", event => {
    const hit = nodeAt(event.offsetX, event.offsetY);
    if (hit) {
      selectedNode = hit;
      showNodeInfo(hit);
    } else {
      selectedNode = null;
      document.getElementById("v1-node-info").style.display = "none";
    }
    draw();
  });

  // ── Zoom controls ─────────────────────────────────────────────────────────
  document.getElementById("v1-zoom-in").addEventListener("click", () =>
    d3.select(canvas).transition().duration(250).call(zoom.scaleBy, 1.5)
  );
  document.getElementById("v1-zoom-out").addEventListener("click", () =>
    d3.select(canvas).transition().duration(250).call(zoom.scaleBy, 0.67)
  );
  document.getElementById("v1-zoom-fit").addEventListener("click", () =>
    d3.select(canvas).transition().duration(400).call(zoom.transform,
      d3.zoomIdentity
        .translate(W / 2 * (1 - INITIAL_SCALE), H / 2 * (1 - INITIAL_SCALE))
        .scale(INITIAL_SCALE))
  );

  // ── Risk filter toggles ───────────────────────────────────────────────────
  document.querySelectorAll(".v1-risk-toggle").forEach(cb => {
    cb.addEventListener("change", applyFilters);
  });
  document.getElementById("v1-recent-only").addEventListener("change", e => {
    recentOnly = e.target.checked;
    applyFilters();
  });

  // ── Edge weight slider ────────────────────────────────────────────────────
  document.getElementById("v1-weight-slider").addEventListener("input", e => {
    minWeight = +e.target.value;
    document.getElementById("v1-weight-label").textContent = minWeight;
    updateStatus();
    draw();
  });

  function applyFilters() {
    hiddenRisk = new Set(
      [...document.querySelectorAll(".v1-risk-toggle")]
        .filter(c => !c.checked)
        .map(c => c.dataset.risk)
    );
    selectedNode = null;
    document.getElementById("v1-node-info").style.display = "none";

    const activeNodes = simNodes.filter(isVisible);
    const activeLinks = simLinks.filter(l =>
      isVisible(l.source) && isVisible(l.target)
    );
    statusEl.textContent = `${activeNodes.length.toLocaleString()} nodes · simulating…`;
    buildSim(activeNodes, activeLinks);
  }

  // ── Node info panel ───────────────────────────────────────────────────────
  function showNodeInfo(d) {
    const box = document.getElementById("v1-node-info");
    box.style.display = "block";
    const flags = parseFlags(d.content_flags);
    document.getElementById("v1-node-info-body").innerHTML = `
      <div class="node-info-row"><span class="node-info-label">Title</span><span>${esc(d.title)}</span></div>
      ${d.username ? `<div class="node-info-row"><span class="node-info-label">Username</span><span style="font-family:monospace">@${esc(d.username)}</span></div>` : ""}
      <div class="node-info-row"><span class="node-info-label">Risk</span><span class="risk-pill ${d.risk_level}">${d.risk_level}</span></div>
      <div class="node-info-row"><span class="node-info-label">Score</span><span>${d.relevance_score != null ? d.relevance_score.toFixed(3) : "—"}</span></div>
      ${d.member_count != null ? `<div class="node-info-row"><span class="node-info-label">Members</span><span>${d.member_count.toLocaleString()}</span></div>` : ""}
      ${d.is_recent ? `<div class="node-info-row"><span style="color:${RECENT_COLOR};font-size:12px;font-weight:600">★ Recently discovered</span></div>` : ""}
      ${flags.length ? `<div class="node-info-row"><span class="node-info-label">Flags</span><span>${flags.map(f => `<span class="flag-chip">${esc(f)}</span>`).join("")}</span></div>` : ""}
    `;
    document.getElementById("v1-messages-btn").onclick = () => {
      if (onSelectChannel) onSelectChannel(d.channel_id);
    };
  }
}

// ── Background-only render (no controls, no interaction) ─────────────────────
export async function renderGraphBg(canvas) {
  let aborted = false;
  let rafId;
  let simRef = null;

  const cleanup = () => {
    aborted = true;
    cancelAnimationFrame(rafId);
    simRef?.stop();
  };

  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  let graphData;
  try { graphData = await fetchGraph(); } catch { return cleanup; }
  if (aborted) return cleanup;

  const { nodes, edges } = graphData;

  // Keep only HIGH + MEDIUM, cap at 400 total
  const hi  = nodes.filter(n => n.risk_level === "high");
  const med = nodes.filter(n => n.risk_level === "medium");
  const bgNodes = [...hi, ...med].slice(0, 400);
  const bgIds   = new Set(bgNodes.map(n => n.channel_id));

  const simNodes = bgNodes.map(n => ({ ...n }));
  const nodeMap  = new Map(simNodes.map(n => [n.channel_id, n]));
  const simLinks = edges
    .filter(e => bgIds.has(e.source_channel_id) && bgIds.has(e.target_channel_id))
    .map(e => ({
      source:    nodeMap.get(e.source_channel_id),
      target:    nodeMap.get(e.target_channel_id),
      edge_type: e.edge_type,
      weight:    e.weight,
    }));

  const maxMembers = Math.max(...simNodes.map(n => n.member_count || 0), 1);
  const nodeR = n => 2 + ((n.member_count || 0) / maxMembers) * 8;

  simRef = d3.forceSimulation(simNodes)
    .force("link",    d3.forceLink(simLinks).id(d => d.channel_id).distance(55).strength(0.4))
    .force("charge",  d3.forceManyBody().strength(-70).theta(0.9))
    .force("center",  d3.forceCenter(W / 2, H / 2))
    .force("collide", d3.forceCollide().radius(d => nodeR(d) + 2).iterations(1))
    .alphaDecay(0.04)
    .velocityDecay(0.4);

  // Very slow circular drift applied after sim settles
  let driftAngle = Math.random() * Math.PI * 2;
  let ox = 0, oy = 0;

  function draw() {
    driftAngle += 0.00015;
    ox += Math.cos(driftAngle) * 0.035;
    oy += Math.sin(driftAngle) * 0.035;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);

    // Edges — same grouping as V1 but at reduced alpha
    const groups = {};
    for (const l of simLinks) {
      if (l.source.x == null) continue;
      (groups[l.edge_type] ??= []).push(l);
    }

    for (const [type, links] of Object.entries(groups)) {
      if (type === "forward") continue;
      ctx.beginPath();
      ctx.strokeStyle = EDGE_COLOR[type] || "#4b5563";
      ctx.lineWidth   = 0.6;
      ctx.globalAlpha = (EDGE_ALPHA[type] ?? 0.25) * 0.55;
      for (const l of links) {
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
      }
      ctx.stroke();
    }

    if (groups.forward) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = EDGE_COLOR.forward;
      ctx.lineWidth   = 0.6;
      ctx.globalAlpha = (EDGE_ALPHA.forward ?? 0.12) * 0.55;
      for (const l of groups.forward) {
        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // Nodes
    for (const n of simNodes) {
      if (n.x == null) continue;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(n.x, n.y, nodeR(n), 0, Math.PI * 2);
      ctx.fillStyle = RISK_COLOR[n.risk_level] || "#6b7280";
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function frame() {
    if (aborted) return;
    draw();
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return cleanup;
}

function parseFlags(flags) {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  try { return JSON.parse(flags); } catch { return []; }
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
