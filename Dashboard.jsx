import { useState, useEffect, useCallback, useRef } from "react";

// ── Color palette ──────────────────────────────────────────────────────────
const C = {
  bg:       "#0a0c10",
  surface:  "#111318",
  border:   "#1e2330",
  accent:   "#e8ff52",      // acid yellow
  danger:   "#ff3b5c",
  warn:     "#ff9d3b",
  med:      "#ffd166",
  low:      "#4ade80",
  muted:    "#4a5270",
  text:     "#cdd6f4",
  dim:      "#6c7693",
  critical: "#ff3b5c",
  high:     "#ff9d3b",
  medium:   "#ffd166",
  unknown:  "#4a5270",
};

const riskColor = (label) => ({
  CRITICAL: C.danger,
  HIGH:     C.warn,
  MEDIUM:   C.med,
  LOW:      C.low,
  UNKNOWN:  C.muted,
}[label] || C.muted);

const riskBg = (label) => ({
  CRITICAL: "rgba(255,59,92,0.12)",
  HIGH:     "rgba(255,157,59,0.12)",
  MEDIUM:   "rgba(255,209,102,0.10)",
  LOW:      "rgba(74,222,128,0.10)",
  UNKNOWN:  "rgba(74,82,112,0.15)",
}[label] || "transparent");

// ── Mock data (replace with real API calls) ────────────────────────────────
const MOCK_STATS = {
  total_channels: 347,
  total_edges: 1204,
  high_risk_count: 68,
  sessions_run: 12,
};

const MOCK_RISK_CHANNELS = [
  { username: "nudify_ai_bot",     display_name: "NudifyAI Bot",      channel_type: "bot",     score: 94.2, risk_label: "CRITICAL", keyword_score: 24, link_score: 23, centrality_score: 22, repost_score: 25, in_degree: 87,  out_degree: 12, unique_keywords: ["nudify","ai undress","remove clothes ai"] },
  { username: "deepfake_studio_x", display_name: "Deepfake Studio X", channel_type: "channel", score: 87.1, risk_label: "CRITICAL", keyword_score: 22, link_score: 19, centrality_score: 24, repost_score: 22, in_degree: 64,  out_degree: 31, unique_keywords: ["deepfake","deepnude","nude generator"] },
  { username: "undress_premium",   display_name: "Undress Premium",   channel_type: "channel", score: 81.4, risk_label: "CRITICAL", keyword_score: 21, link_score: 20, centrality_score: 20, repost_score: 20, in_degree: 52,  out_degree: 18, unique_keywords: ["ai undress","nudify","nsfw bot"] },
  { username: "ai_unclothed_v2",   display_name: "AI Unclothed v2",   channel_type: "bot",     score: 75.8, risk_label: "HIGH",     keyword_score: 20, link_score: 18, centrality_score: 18, repost_score: 20, in_degree: 43,  out_degree: 9,  unique_keywords: ["nudify","remove clothes ai"] },
  { username: "deepnude_hub",      display_name: "DeepNude Hub",      channel_type: "channel", score: 71.2, risk_label: "HIGH",     keyword_score: 19, link_score: 17, centrality_score: 19, repost_score: 16, in_degree: 38,  out_degree: 25, unique_keywords: ["deepnude","deepfake"] },
  { username: "fakebot_pro",       display_name: "FakeBot Pro",       channel_type: "bot",     score: 65.5, risk_label: "HIGH",     keyword_score: 17, link_score: 16, centrality_score: 17, repost_score: 15, in_degree: 29,  out_degree: 7,  unique_keywords: ["deepfake","nsfw bot"] },
  { username: "synth_media_ch",    display_name: "Synth Media",       channel_type: "channel", score: 55.0, risk_label: "HIGH",     keyword_score: 14, link_score: 13, centrality_score: 14, repost_score: 14, in_degree: 22,  out_degree: 14, unique_keywords: ["deepfake"] },
  { username: "pixelstripper_bot", display_name: "PixelStripper",     channel_type: "bot",     score: 48.7, risk_label: "MEDIUM",   keyword_score: 12, link_score: 12, centrality_score: 12, repost_score: 12, in_degree: 18,  out_degree: 6,  unique_keywords: ["nudify"] },
  { username: "gen_content_hub",   display_name: "Gen Content Hub",   channel_type: "channel", score: 38.2, risk_label: "MEDIUM",   keyword_score: 10, link_score: 9,  centrality_score: 10, repost_score: 9,  in_degree: 14,  out_degree: 22, unique_keywords: ["nsfw bot"] },
  { username: "aigen_fan_zone",    display_name: "AIGen Fan Zone",    channel_type: "group",   score: 22.1, risk_label: "LOW",      keyword_score: 6,  link_score: 5,  centrality_score: 6,  repost_score: 5,  in_degree: 8,   out_degree: 11, unique_keywords: [] },
];

const MOCK_INSIGHTS = {
  top_hubs: [
    { username: "nudify_ai_bot",     pagerank: 0.124, in_degree: 87, score: 94.2 },
    { username: "deepfake_studio_x", pagerank: 0.098, in_degree: 64, score: 87.1 },
    { username: "undress_premium",   pagerank: 0.082, in_degree: 52, score: 81.4 },
    { username: "deepnude_hub",      pagerank: 0.071, in_degree: 38, score: 71.2 },
    { username: "ai_unclothed_v2",   pagerank: 0.065, in_degree: 43, score: 75.8 },
  ],
  most_promoted_bots: [
    { username: "nudify_ai_bot",     in_degree: 87, score: 94.2 },
    { username: "ai_unclothed_v2",   in_degree: 43, score: 75.8 },
    { username: "fakebot_pro",       in_degree: 29, score: 65.5 },
    { username: "pixelstripper_bot", in_degree: 18, score: 48.7 },
  ],
  cluster_summary: [
    { cluster_id: 0, size: 142, members: ["nudify_ai_bot","deepfake_studio_x","undress_premium","ai_unclothed_v2","deepnude_hub"] },
    { cluster_id: 1, size: 89,  members: ["fakebot_pro","synth_media_ch","gen_content_hub"] },
    { cluster_id: 2, size: 34,  members: ["pixelstripper_bot","aigen_fan_zone"] },
    { cluster_id: 3, size: 82,  members: ["other_cluster_a","other_cluster_b"] },
  ],
  fastest_spreading: [
    { channel: "undress_premium",   forward_count: 8420, keyword_flags: ["nudify","ai undress"] },
    { channel: "deepfake_studio_x", forward_count: 6105, keyword_flags: ["deepfake"] },
    { channel: "nudify_ai_bot",     forward_count: 5290, keyword_flags: ["nudify"] },
    { channel: "deepnude_hub",      forward_count: 3870, keyword_flags: ["deepnude"] },
    { channel: "gen_content_hub",   forward_count: 1950, keyword_flags: [] },
  ],
};

// Mini network data for the force graph
const MOCK_GRAPH_NODES = [
  { id: "nudify_ai_bot",     score: 94, risk_label: "CRITICAL", type: "bot" },
  { id: "deepfake_studio_x", score: 87, risk_label: "CRITICAL", type: "channel" },
  { id: "undress_premium",   score: 81, risk_label: "CRITICAL", type: "channel" },
  { id: "ai_unclothed_v2",   score: 76, risk_label: "HIGH",     type: "bot" },
  { id: "deepnude_hub",      score: 71, risk_label: "HIGH",     type: "channel" },
  { id: "fakebot_pro",       score: 65, risk_label: "HIGH",     type: "bot" },
  { id: "synth_media_ch",    score: 55, risk_label: "HIGH",     type: "channel" },
  { id: "pixelstripper_bot", score: 49, risk_label: "MEDIUM",   type: "bot" },
  { id: "gen_content_hub",   score: 38, risk_label: "MEDIUM",   type: "channel" },
  { id: "aigen_fan_zone",    score: 22, risk_label: "LOW",      type: "group" },
];
const MOCK_GRAPH_EDGES = [
  { source: "deepfake_studio_x", target: "nudify_ai_bot",     type: "LINKS_TO",      w: 12 },
  { source: "undress_premium",   target: "nudify_ai_bot",     type: "FORWARDED_FROM", w: 8 },
  { source: "deepnude_hub",      target: "deepfake_studio_x", type: "MENTIONS",       w: 6 },
  { source: "synth_media_ch",    target: "deepfake_studio_x", type: "LINKS_TO",       w: 5 },
  { source: "fakebot_pro",       target: "nudify_ai_bot",     type: "LINKS_TO",       w: 9 },
  { source: "gen_content_hub",   target: "fakebot_pro",       type: "FORWARDED_FROM", w: 4 },
  { source: "ai_unclothed_v2",   target: "nudify_ai_bot",     type: "LINKS_TO",       w: 7 },
  { source: "pixelstripper_bot", target: "ai_unclothed_v2",   type: "MENTIONS",       w: 3 },
  { source: "aigen_fan_zone",    target: "gen_content_hub",   type: "LINKS_TO",       w: 2 },
  { source: "undress_premium",   target: "deepfake_studio_x", type: "MENTIONS",       w: 5 },
  { source: "deepnude_hub",      target: "nudify_ai_bot",     type: "FORWARDED_FROM", w: 11 },
  { source: "synth_media_ch",    target: "fakebot_pro",       type: "LINKS_TO",       w: 3 },
];

// ── Force-directed graph canvas ────────────────────────────────────────────
function ForceGraph({ nodes, edges, selectedNode, onNodeClick }) {
  const canvasRef = useRef(null);
  const simRef = useRef({ positions: {}, velocities: {}, running: true });
  const rafRef = useRef(null);
  const hoverRef = useRef(null);

  // Initialize positions
  useEffect(() => {
    const cx = 300, cy = 220;
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const r = 120 + Math.random() * 60;
      simRef.current.positions[n.id] = {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      };
      simRef.current.velocities[n.id] = { x: 0, y: 0 };
    });
    simRef.current.running = true;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let tick = 0;

    const simulate = () => {
      tick++;
      const pos = simRef.current.positions;
      const vel = simRef.current.velocities;
      const damping = 0.75;
      const repulse = 2200;
      const attract = 0.022;
      const center_f = 0.008;
      const cx = canvas.width / 2, cy = canvas.height / 2;

      if (tick < 300) {
        // Repulsion
        nodes.forEach(a => {
          nodes.forEach(b => {
            if (a.id === b.id) return;
            const dx = pos[a.id].x - pos[b.id].x;
            const dy = pos[a.id].y - pos[b.id].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const f = repulse / (dist * dist);
            vel[a.id].x += (dx / dist) * f;
            vel[a.id].y += (dy / dist) * f;
          });
        });

        // Attraction along edges
        edges.forEach(e => {
          if (!pos[e.source] || !pos[e.target]) return;
          const dx = pos[e.target].x - pos[e.source].x;
          const dy = pos[e.target].y - pos[e.source].y;
          vel[e.source].x += dx * attract;
          vel[e.source].y += dy * attract;
          vel[e.target].x -= dx * attract;
          vel[e.target].y -= dy * attract;
        });

        // Center gravity
        nodes.forEach(n => {
          vel[n.id].x += (cx - pos[n.id].x) * center_f;
          vel[n.id].y += (cy - pos[n.id].y) * center_f;
          vel[n.id].x *= damping;
          vel[n.id].y *= damping;
          pos[n.id].x += vel[n.id].x;
          pos[n.id].y += vel[n.id].y;
          // Clamp
          pos[n.id].x = Math.max(30, Math.min(canvas.width - 30, pos[n.id].x));
          pos[n.id].y = Math.max(30, Math.min(canvas.height - 30, pos[n.id].y));
        });
      }

      // Draw
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = C.surface;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Edges
      edges.forEach(e => {
        if (!pos[e.source] || !pos[e.target]) return;
        const a = pos[e.source], b = pos[e.target];
        const col = e.type === "FORWARDED_FROM" ? "#e8ff5244" :
                    e.type === "MENTIONS"       ? "#a78bfa44" : "#38bdf844";
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.min(1 + e.w * 0.15, 3);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Arrow
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const dist = Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2);
        const targetR = 10 + (nodes.find(n=>n.id===e.target)?.score||50)/12;
        const ax = b.x - Math.cos(angle) * targetR;
        const ay = b.y - Math.sin(angle) * targetR;
        ctx.fillStyle = col.replace("44","99");
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - Math.cos(angle-0.4)*7, ay - Math.sin(angle-0.4)*7);
        ctx.lineTo(ax - Math.cos(angle+0.4)*7, ay - Math.sin(angle+0.4)*7);
        ctx.fill();
      });

      // Nodes
      nodes.forEach(n => {
        const p = pos[n.id];
        const r = 8 + n.score / 12;
        const color = riskColor(n.risk_label);
        const isSelected = selectedNode === n.id;
        const isHovered = hoverRef.current === n.id;

        // Glow
        if (isSelected || isHovered) {
          const grd = ctx.createRadialGradient(p.x, p.y, r, p.x, p.y, r * 2.8);
          grd.addColorStop(0, color + "55");
          grd.addColorStop(1, "transparent");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.8, 0, Math.PI * 2);
          ctx.fill();
        }

        // Node circle
        ctx.fillStyle = color + (isSelected ? "ff" : "cc");
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Bot square marker
        if (n.type === "bot") {
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(p.x - r * 0.6, p.y - r * 0.6, r * 1.2, r * 1.2);
        }

        // Label (only for selected/hovered or large nodes)
        if (isSelected || isHovered || n.score > 75) {
          ctx.fillStyle = "#ffffffcc";
          ctx.font = `${isSelected ? "bold " : ""}10px monospace`;
          ctx.textAlign = "center";
          ctx.fillText("@" + n.id.slice(0, 16), p.x, p.y + r + 12);
        }
      });

      rafRef.current = requestAnimationFrame(simulate);
    };

    simulate();
    return () => {
      cancelAnimationFrame(rafRef.current);
      simRef.current.running = false;
    };
  }, [nodes, edges, selectedNode]);

  const handleCanvasClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const my = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);
    const pos = simRef.current.positions;

    for (const n of nodes) {
      const p = pos[n.id];
      if (!p) continue;
      const r = 8 + n.score / 12;
      const dx = mx - p.x, dy = my - p.y;
      if (dx*dx + dy*dy <= r*r*2) {
        onNodeClick(n.id);
        return;
      }
    }
    onNodeClick(null);
  }, [nodes, onNodeClick]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const my = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);
    const pos = simRef.current.positions;

    for (const n of nodes) {
      const p = pos[n.id];
      if (!p) continue;
      const r = 8 + n.score / 12;
      const dx = mx - p.x, dy = my - p.y;
      if (dx*dx + dy*dy <= r*r*2.5) {
        if (hoverRef.current !== n.id) { hoverRef.current = n.id; }
        canvasRef.current.style.cursor = "pointer";
        return;
      }
    }
    hoverRef.current = null;
    canvasRef.current.style.cursor = "default";
  }, [nodes]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={440}
      onClick={handleCanvasClick}
      onMouseMove={handleMouseMove}
      style={{ width: "100%", height: "100%", display: "block", borderRadius: 8 }}
    />
  );
}

// ── Score bar ──────────────────────────────────────────────────────────────
function ScoreBar({ label, value, max = 25, color }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10,
        color: C.dim, marginBottom: 3 }}>
        <span>{label}</span><span>{value.toFixed(1)}/{max}</span>
      </div>
      <div style={{ background: C.border, borderRadius: 2, height: 4 }}>
        <div style={{
          width: `${(value / max) * 100}%`, height: "100%",
          background: color, borderRadius: 2,
          transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ── Risk badge ─────────────────────────────────────────────────────────────
function RiskBadge({ label }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
      color: riskColor(label),
      background: riskBg(label),
      border: `1px solid ${riskColor(label)}44`,
      padding: "2px 6px", borderRadius: 3,
    }}>
      {label}
    </span>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ value, label, color = C.accent, sub }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: "16px 20px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: "monospace", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: 10, color: C.muted }}>{sub}</div>}
    </div>
  );
}

// ── Ingest panel ───────────────────────────────────────────────────────────
function IngestPanel({ onClose }) {
  const [seeds, setSeeds] = useState("");
  const [depth, setDepth] = useState(2);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!seeds.trim()) return;
    setLoading(true);
    // Simulate API call
    await new Promise(r => setTimeout(r, 1200));
    setStatus({ session_id: "sess_" + Math.random().toString(36).slice(2,8), seeds_queued: seeds.split("\n").filter(Boolean).length });
    setLoading(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }} onClick={onClose}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 28, width: 480, maxWidth: "95vw",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>New Crawl Session</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <label style={{ fontSize: 11, color: C.dim, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Seed Channels (one per line: username or t.me/link)
        </label>
        <textarea
          value={seeds}
          onChange={e => setSeeds(e.target.value)}
          placeholder={"nudify_ai_bot\nt.me/deepfake_studio\nundress_premium"}
          style={{
            width: "100%", height: 120, background: C.bg,
            border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px",
            color: C.text, fontFamily: "monospace", fontSize: 12, resize: "vertical",
            outline: "none", boxSizing: "border-box",
          }}
        />

        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 16 }}>
          <label style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Max Depth
          </label>
          {[1,2,3].map(d => (
            <button key={d} onClick={() => setDepth(d)} style={{
              padding: "4px 14px", borderRadius: 4, cursor: "pointer",
              background: depth === d ? C.accent : C.bg,
              color: depth === d ? C.bg : C.muted,
              border: `1px solid ${depth === d ? C.accent : C.border}`,
              fontSize: 12, fontWeight: 700,
            }}>{d}</button>
          ))}
        </div>

        <div style={{ marginTop: 6, fontSize: 10, color: C.muted }}>
          ⚠ Deeper crawls take longer and make more API calls. Depth 2 recommended.
        </div>

        {status ? (
          <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(232,255,82,0.08)",
            border: `1px solid ${C.accent}44`, borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: C.accent, fontWeight: 700 }}>✓ Session queued</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
              ID: <code style={{ color: C.text }}>{status.session_id}</code> · {status.seeds_queued} seeds
            </div>
          </div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={loading || !seeds.trim()}
            style={{
              marginTop: 18, width: "100%", padding: "11px",
              background: loading ? C.muted : C.accent,
              color: C.bg, border: "none", borderRadius: 6,
              fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}>
            {loading ? "Queueing…" : "Start Crawl"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function TNAS() {
  const [tab, setTab] = useState("graph");
  const [selectedNode, setSelectedNode] = useState(null);
  const [showIngest, setShowIngest] = useState(false);
  const [filterLabel, setFilterLabel] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  const selectedChannel = MOCK_RISK_CHANNELS.find(c => c.username === selectedNode);
  const filteredChannels = MOCK_RISK_CHANNELS.filter(c => {
    const matchLabel = filterLabel === "ALL" || c.risk_label === filterLabel;
    const matchSearch = !searchTerm || c.username.includes(searchTerm.toLowerCase()) || (c.display_name || "").toLowerCase().includes(searchTerm.toLowerCase());
    return matchLabel && matchSearch;
  });

  const edgeTypeColors = { FORWARDED_FROM: C.accent, MENTIONS: "#a78bfa", LINKS_TO: "#38bdf8" };

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
      background: C.bg, minHeight: "100vh", color: C.text,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <header style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "12px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: C.surface,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: C.accent, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 16,
          }}>⬡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: "0.04em" }}>
              TNAS
            </div>
            <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Telegram Network Analysis System
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 9, color: C.muted, padding: "4px 10px",
            background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
            borderRadius: 4 }}>
            ● LIVE
          </div>
          <button
            onClick={() => setShowIngest(true)}
            style={{
              padding: "7px 16px", background: C.accent, color: C.bg,
              border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700,
              cursor: "pointer", letterSpacing: "0.04em",
            }}>
            + New Crawl
          </button>
        </div>
      </header>

      {/* Stats row */}
      <div style={{ padding: "16px 24px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        <StatCard value={MOCK_STATS.total_channels} label="Channels Mapped" color={C.text} />
        <StatCard value={MOCK_STATS.total_edges}    label="Network Edges"   color="#38bdf8" />
        <StatCard value={MOCK_STATS.high_risk_count} label="High-Risk Nodes" color={C.danger} sub="CRITICAL + HIGH" />
        <StatCard value={MOCK_STATS.sessions_run}   label="Crawl Sessions"  color={C.accent} />
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 24px", display: "flex", gap: 2, borderBottom: `1px solid ${C.border}` }}>
        {[["graph","Network Graph"],["risk","Risk Table"],["insights","Insights"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "10px 18px", background: "none",
            border: "none", borderBottom: tab === id ? `2px solid ${C.accent}` : "2px solid transparent",
            color: tab === id ? C.accent : C.dim,
            fontSize: 11, fontWeight: tab === id ? 700 : 400,
            cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
            marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "20px 24px", display: "flex", gap: 16, overflow: "hidden" }}>

        {/* ── GRAPH TAB ── */}
        {tab === "graph" && (
          <>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Graph canvas */}
              <div style={{
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 10, overflow: "hidden", flex: 1, minHeight: 440,
                position: "relative",
              }}>
                <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10,
                  fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Network Graph · {MOCK_GRAPH_NODES.length} nodes · {MOCK_GRAPH_EDGES.length} edges
                </div>
                {/* Legend */}
                <div style={{ position: "absolute", bottom: 12, left: 12, zIndex: 10,
                  display: "flex", gap: 14, fontSize: 9, color: C.dim }}>
                  {Object.entries(edgeTypeColors).map(([type, color]) => (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 18, height: 2, background: color, opacity: 0.7 }} />
                      {type.replace("_", " ")}
                    </div>
                  ))}
                </div>
                <ForceGraph
                  nodes={MOCK_GRAPH_NODES}
                  edges={MOCK_GRAPH_EDGES}
                  selectedNode={selectedNode}
                  onNodeClick={setSelectedNode}
                />
              </div>
            </div>

            {/* Side panel */}
            <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedChannel ? (
                <div style={{ background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                        @{selectedChannel.username}
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                        {selectedChannel.display_name}
                      </div>
                    </div>
                    <RiskBadge label={selectedChannel.risk_label} />
                  </div>

                  {/* Big score */}
                  <div style={{ textAlign: "center", padding: "14px 0",
                    background: riskBg(selectedChannel.risk_label),
                    borderRadius: 8, border: `1px solid ${riskColor(selectedChannel.risk_label)}22` }}>
                    <div style={{ fontSize: 42, fontWeight: 800, color: riskColor(selectedChannel.risk_label), lineHeight: 1 }}>
                      {selectedChannel.score.toFixed(1)}
                    </div>
                    <div style={{ fontSize: 9, color: C.dim, marginTop: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Risk Score / 100
                    </div>
                  </div>

                  {/* Component bars */}
                  <div>
                    <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
                      Score Components
                    </div>
                    <ScoreBar label="Keyword Freq"   value={selectedChannel.keyword_score}    color={C.danger} />
                    <ScoreBar label="Link Profile"   value={selectedChannel.link_score}        color={C.warn} />
                    <ScoreBar label="Graph Centrality" value={selectedChannel.centrality_score} color="#a78bfa" />
                    <ScoreBar label="Repost Activity" value={selectedChannel.repost_score}     color="#38bdf8" />
                  </div>

                  {/* Graph metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      ["In-Degree", selectedChannel.in_degree],
                      ["Out-Degree", selectedChannel.out_degree],
                      ["Type", selectedChannel.channel_type],
                      ["Status", "PUBLIC"],
                    ].map(([k, v]) => (
                      <div key={k} style={{ background: C.bg, borderRadius: 6, padding: "8px 10px" }}>
                        <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>{k}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 2 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Keywords */}
                  {selectedChannel.unique_keywords.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                        Matched Keywords
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {selectedChannel.unique_keywords.map(kw => (
                          <span key={kw} style={{
                            fontSize: 9, padding: "2px 7px", borderRadius: 3,
                            background: "rgba(255,59,92,0.1)", color: C.danger,
                            border: "1px solid rgba(255,59,92,0.2)",
                          }}>{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <button onClick={() => setSelectedNode(null)} style={{
                    background: "none", border: `1px solid ${C.border}`,
                    color: C.muted, borderRadius: 6, padding: "7px",
                    fontSize: 10, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em",
                  }}>Clear Selection</button>
                </div>
              ) : (
                <div style={{ background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: 20, color: C.muted, fontSize: 11,
                  textAlign: "center", lineHeight: 1.7 }}>
                  <div style={{ fontSize: 24, marginBottom: 10 }}>⬡</div>
                  Click a node to inspect channel details, risk breakdown, and graph metrics.
                </div>
              )}

              {/* Top hubs mini list */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase",
                  letterSpacing: "0.1em", marginBottom: 12 }}>Top Hubs by PageRank</div>
                {MOCK_INSIGHTS.top_hubs.map((h, i) => (
                  <div key={h.username} onClick={() => setSelectedNode(h.username)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                      borderBottom: i < MOCK_INSIGHTS.top_hubs.length-1 ? `1px solid ${C.border}` : "none",
                      cursor: "pointer" }}>
                    <div style={{ fontSize: 9, color: C.muted, width: 14 }}>#{i+1}</div>
                    <div style={{ flex: 1, fontSize: 10, color: C.text }}>@{h.username}</div>
                    <div style={{ fontSize: 10, color: C.accent, fontFamily: "monospace" }}>
                      {(h.pagerank * 100).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── RISK TABLE TAB ── */}
        {tab === "risk" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Filters */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search channel..."
                style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  color: C.text, padding: "7px 12px", borderRadius: 6,
                  fontSize: 11, outline: "none", width: 220, fontFamily: "inherit",
                }}
              />
              {["ALL","CRITICAL","HIGH","MEDIUM","LOW"].map(l => (
                <button key={l} onClick={() => setFilterLabel(l)} style={{
                  padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: 700,
                  background: filterLabel === l ? (l === "ALL" ? C.accent : riskColor(l)) : C.surface,
                  color: filterLabel === l ? C.bg : C.muted,
                  border: `1px solid ${filterLabel === l ? "transparent" : C.border}`,
                  letterSpacing: "0.06em",
                }}>{l}</button>
              ))}
              <div style={{ marginLeft: "auto", fontSize: 10, color: C.dim }}>
                {filteredChannels.length} channels
              </div>
            </div>

            {/* Table */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Channel","Type","Risk","Score","Keywords","In ↓","Out →","Bots →"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", color: C.dim, fontWeight: 600,
                        textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em",
                        whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredChannels.map((ch, i) => (
                    <tr key={ch.username}
                      onClick={() => { setSelectedNode(ch.username); setTab("graph"); }}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(232,255,82,0.04)"}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)"}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ color: C.text, fontWeight: 600 }}>@{ch.username}</div>
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 1 }}>{ch.display_name}</div>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 9, color: ch.channel_type === "bot" ? C.accent : C.muted,
                          textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {ch.channel_type === "bot" ? "⬡ BOT" : ch.channel_type?.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px" }}><RiskBadge label={ch.risk_label} /></td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 50, height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ width: `${ch.score}%`, height: "100%",
                              background: riskColor(ch.risk_label) }} />
                          </div>
                          <span style={{ color: riskColor(ch.risk_label), fontWeight: 700 }}>
                            {ch.score.toFixed(1)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 180 }}>
                          {ch.unique_keywords.slice(0,2).map(kw => (
                            <span key={kw} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2,
                              background: "rgba(255,59,92,0.1)", color: C.danger,
                              border: "1px solid rgba(255,59,92,0.15)" }}>{kw}</span>
                          ))}
                          {ch.unique_keywords.length > 2 && (
                            <span style={{ fontSize: 8, color: C.muted }}>+{ch.unique_keywords.length - 2}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "10px 14px", color: C.text, fontWeight: 600 }}>{ch.in_degree}</td>
                      <td style={{ padding: "10px 14px", color: C.dim }}>{ch.out_degree}</td>
                      <td style={{ padding: "10px 14px", color: ch.link_score > 15 ? C.warn : C.dim }}>
                        {Math.round(ch.link_score * 0.8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Export bar */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <a href="/export/csv" style={{ textDecoration: "none" }}>
                <button style={{ padding: "7px 14px", background: C.surface,
                  border: `1px solid ${C.border}`, color: C.dim,
                  borderRadius: 6, fontSize: 10, cursor: "pointer",
                  fontFamily: "inherit", letterSpacing: "0.06em" }}>
                  ↓ Export CSV
                </button>
              </a>
              <a href="/export/json" style={{ textDecoration: "none" }}>
                <button style={{ padding: "7px 14px", background: C.surface,
                  border: `1px solid ${C.border}`, color: C.dim,
                  borderRadius: 6, fontSize: 10, cursor: "pointer",
                  fontFamily: "inherit", letterSpacing: "0.06em" }}>
                  ↓ Export JSON
                </button>
              </a>
            </div>
          </div>
        )}

        {/* ── INSIGHTS TAB ── */}
        {tab === "insights" && (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

            {/* Clusters */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
                Detected Communities
              </div>
              {MOCK_INSIGHTS.cluster_summary.map((cl, i) => (
                <div key={cl.cluster_id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: C.text, fontWeight: 600 }}>Cluster {cl.cluster_id}</span>
                    <span style={{ fontSize: 10, color: C.dim }}>{cl.size} nodes</span>
                  </div>
                  <div style={{ background: C.bg, borderRadius: 5, height: 6, overflow: "hidden" }}>
                    <div style={{
                      width: `${(cl.size / 200) * 100}%`, height: "100%",
                      background: [C.danger, C.warn, "#a78bfa", "#38bdf8"][i % 4],
                    }} />
                  </div>
                  <div style={{ marginTop: 5, fontSize: 9, color: C.muted }}>
                    {cl.members.slice(0,3).map(m => `@${m}`).join(" · ")}
                    {cl.members.length > 3 && ` +${cl.size - 3} more`}
                  </div>
                </div>
              ))}
            </div>

            {/* Fastest spreading */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
                Fastest Spreading Content
              </div>
              {MOCK_INSIGHTS.fastest_spreading.map((item, i) => (
                <div key={item.channel} style={{ display: "flex", gap: 12, alignItems: "center",
                  padding: "8px 0", borderBottom: i < MOCK_INSIGHTS.fastest_spreading.length-1 ? `1px solid ${C.border}` : "none" }}>
                  <div style={{ fontSize: 9, color: C.muted, width: 16, textAlign: "right" }}>#{i+1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: C.text, fontWeight: 600 }}>@{item.channel}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>
                      {item.keyword_flags.join(", ") || "no keyword flags"}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, fontFamily: "monospace" }}>
                    {item.forward_count.toLocaleString()}
                    <span style={{ fontSize: 8, color: C.dim, fontWeight: 400, marginLeft: 3 }}>fwds</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Most promoted bots */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
                Most Promoted Bots
              </div>
              {MOCK_INSIGHTS.most_promoted_bots.map((bot, i) => (
                <div key={bot.username} onClick={() => { setSelectedNode(bot.username); setTab("graph"); }}
                  style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0",
                    borderBottom: i < MOCK_INSIGHTS.most_promoted_bots.length-1 ? `1px solid ${C.border}` : "none",
                    cursor: "pointer" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 5, background: "rgba(232,255,82,0.1)",
                    border: `1px solid ${C.accent}33`, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: 12 }}>⬡</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: C.text, fontWeight: 600 }}>@{bot.username}</div>
                    <div style={{ fontSize: 9, color: C.muted }}>Risk: {bot.score}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.danger }}>{bot.in_degree}</div>
                    <div style={{ fontSize: 8, color: C.muted }}>incoming links</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Ethics notice */}
            <div style={{ background: "rgba(74,222,128,0.04)", border: `1px solid rgba(74,222,128,0.15)`,
              borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 9, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                ✓ Research Ethics Notice
              </div>
              {[
                "Public channels only — no private group access",
                "No media content downloaded or stored",
                "Full message text is not persisted — keyword flags only",
                "No individual user profiles tracked",
                "Single controlled research account · Rate limits respected",
                "Official Telegram API (MTProto) — no scraping",
              ].map(item => (
                <div key={item} style={{ fontSize: 10, color: C.dim, display: "flex", gap: 8 }}>
                  <span style={{ color: "#4ade80" }}>›</span> {item}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showIngest && <IngestPanel onClose={() => setShowIngest(false)} />}
    </div>
  );
}
