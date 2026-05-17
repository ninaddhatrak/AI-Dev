import { fetchChannels } from "../api.js";

const PAGE_SIZE = 50;

/* ── CSV export helper ─────────────────────────────────────── */
function downloadCSV(rows, filename) {
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = ["Title", "Username", "Risk Level", "Score", "Members", "Last Seen", "Flags"];
  const lines = [
    headers.join(","),
    ...rows.map((ch) => {
      const flags = parseFlags(ch.content_flags).join("; ");
      const score = ch.relevance_score != null ? ch.relevance_score.toFixed(3) : "";
      const members = ch.member_count != null ? ch.member_count : "";
      const lastSeen = ch.last_seen ? new Date(ch.last_seen).toLocaleDateString() : "";
      return [ch.title, ch.username ? `@${ch.username}` : "", ch.risk_level, score, members, lastSeen, flags]
        .map(escape)
        .join(",");
    }),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const EXPORT_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 10V2M4 7l4 4 4-4M2 13h12"/>
</svg>`;

/* ── Main render ────────────────────────────────────────────── */
export async function renderChannelTable(container, { onSelectChannel } = {}) {
  // All channels loaded for the current filter — kept in state so export works
  let state = { riskLevel: "all", search: "", offset: 0, total: 0, channels: [] };

  /* ── Toolbar HTML ─────────────────────────────────────────── */
  function toolbarHtml() {
    return `
      <div class="toolbar">
        <input
          class="search-input"
          id="ch-search"
          placeholder="Search by name or @username…"
          value="${esc(state.search)}"
          style="flex:1;min-width:200px;max-width:320px"
        />
        <div class="filter-chips">
          ${["all", "high", "medium", "low", "unclassified"].map((r) => `
            <button class="chip ${state.riskLevel === r ? "active" : ""}" data-risk="${r}">
              ${r === "all" ? "All" : cap(r)}
            </button>`).join("")}
        </div>
        <button class="btn btn-export" id="ch-export-btn" title="Export current view as CSV">
          ${EXPORT_ICON} Export CSV
        </button>
      </div>`;
  }

  /* ── Table HTML ───────────────────────────────────────────── */
  function tableHtml() {
    if (!state.channels.length) {
      return `<div class="empty-state">No channels match your filter.</div>`;
    }
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Risk</th>
              <th>Score</th>
              <th>Members</th>
              <th>Flags</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            ${state.channels.map((ch) => channelRow(ch)).join("")}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span style="color:var(--muted);font-size:13px">
          ${state.offset + 1}–${Math.min(state.offset + state.channels.length, state.total)}
          of ${state.total.toLocaleString()}
        </span>
        <button class="btn" id="ch-prev" ${state.offset === 0 ? "disabled" : ""}>← Prev</button>
        <button class="btn" id="ch-next" ${state.offset + state.channels.length >= state.total ? "disabled" : ""}>Next →</button>
      </div>`;
  }

  /* ── Single row ───────────────────────────────────────────── */
  function channelRow(ch) {
    const score   = ch.relevance_score != null ? ch.relevance_score.toFixed(2) : null;
    const flags   = parseFlags(ch.content_flags);
    const lastSeen = ch.last_seen ? new Date(ch.last_seen).toLocaleDateString() : "—";
    return `
      <tr data-id="${esc(ch.channel_id)}">
        <td>
          <div style="font-weight:600;color:var(--text)">${esc(ch.title)}</div>
          ${ch.username
            ? `<div style="color:var(--muted);font-size:11px;font-family:monospace;margin-top:2px">@${esc(ch.username)}</div>`
            : ""}
        </td>
        <td><span class="risk-pill ${esc(ch.risk_level)}">${esc(ch.risk_level)}</span></td>
        <td>
          ${score != null
            ? `<div class="score-bar-wrap">
                <div class="score-bar" style="width:${Math.round(ch.relevance_score * 64)}px"></div>
                <span style="font-size:12px;color:var(--muted)">${score}</span>
               </div>`
            : `<span style="color:var(--muted)">—</span>`}
        </td>
        <td style="color:var(--text2);font-variant-numeric:tabular-nums">
          ${ch.member_count != null ? ch.member_count.toLocaleString() : "—"}
        </td>
        <td>
          ${flags.slice(0, 3).map((f) => `<span class="flag-chip">${esc(formatFlag(f))}</span>`).join("") || `<span style="color:var(--muted)">—</span>`}
          ${flags.length > 3 ? `<span class="flag-chip">+${flags.length - 3}</span>` : ""}
        </td>
        <td style="color:var(--muted);font-size:12px">${lastSeen}</td>
      </tr>`;
  }

  /* ── Load data from API ───────────────────────────────────── */
  async function load() {
    const area = container.querySelector("#ch-table-area");
    if (area) area.innerHTML = tableSkeletonHtml();

    try {
      const data = await fetchChannels({
        riskLevel: state.riskLevel,
        search: state.search,
        limit: PAGE_SIZE,
        offset: state.offset,
      });
      state.channels = data.channels;
      state.total    = data.total;
    } catch {
      if (area) area.innerHTML = `<div class="empty-state">API error — is the server running?</div>`;
      return;
    }

    if (area) area.innerHTML = tableHtml();
    bindTableEvents();

    // Keep export button label in sync with current total
    const exportBtn = container.querySelector("#ch-export-btn");
    if (exportBtn && !exportBtn.disabled) {
      exportBtn.innerHTML = `${EXPORT_ICON} Export CSV (${state.total.toLocaleString()})`;
    }
  }

  /* ── Bind table controls ──────────────────────────────────── */
  function bindTableEvents() {
    container.querySelector("#ch-prev")?.addEventListener("click", () => {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      load();
    });
    container.querySelector("#ch-next")?.addEventListener("click", () => {
      state.offset += PAGE_SIZE;
      load();
    });
    container.querySelectorAll("tbody tr").forEach((row) => {
      row.addEventListener("click", () => {
        if (onSelectChannel) onSelectChannel(row.dataset.id);
      });
    });
  }

  /* ── Export handler — fetches ALL pages with current filters ── */
  async function handleExport() {
    const btn = container.querySelector("#ch-export-btn");
    if (!btn || btn.disabled) return;

    // Show loading state on button
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></span> Loading…`;

    try {
      const BATCH = 500; // max the API allows
      let allRows = [];
      let offset  = 0;
      let total   = Infinity;

      while (offset < total) {
        const data = await fetchChannels({
          riskLevel: state.riskLevel,
          search:    state.search,
          limit:     BATCH,
          offset,
        });
        total   = data.total;
        allRows = allRows.concat(data.channels);
        offset += data.channels.length;
        if (!data.channels.length) break; // safety guard

        // Update button label so the user sees progress
        btn.innerHTML = `<span style="display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></span> ${allRows.length} / ${total}`;
      }

      if (!allRows.length) return;

      const riskLabel = state.riskLevel === "all" ? "all" : state.riskLevel;
      const date      = new Date().toISOString().split("T")[0];
      downloadCSV(allRows, `channels_${riskLabel}_${date}.csv`);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${EXPORT_ICON} Export CSV (${state.total.toLocaleString()})`;
    }
  }

  /* ── Initial render ───────────────────────────────────────── */
  container.innerHTML = `
    <div class="page-header">
      <h1>Channels</h1>
      <p>All scraped channels — click a row to browse messages</p>
    </div>
    <div id="ch-toolbar-area"></div>
    <div id="ch-table-area">${tableSkeletonHtml()}</div>
  `;

  // Render toolbar
  container.querySelector("#ch-toolbar-area").innerHTML = toolbarHtml();

  /* ── Bind toolbar controls ────────────────────────────────── */

  // Risk chips
  container.querySelectorAll(".chip[data-risk]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.riskLevel = btn.dataset.risk;
      state.offset = 0;
      // Update chip active state
      container.querySelectorAll(".chip[data-risk]").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
      load();
    });
  });

  // Search with debounce
  let searchTimer;
  container.querySelector("#ch-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.offset = 0;
      load();
    }, 300);
  });

  // Export button — delegate via event bubbling since toolbar may re-render
  container.addEventListener("click", (e) => {
    if (e.target.closest("#ch-export-btn")) handleExport();
  });

  await load();
}

/* ── Skeleton ───────────────────────────────────────────────── */
function tableSkeletonHtml() {
  const rows = [
    [140, 88], [110, 72], [160, 96], [125, 80],
    [150, 68], [105, 90], [135, 76], [120, 84],
    [155, 70], [115, 94],
  ];
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Channel</th><th>Risk</th><th>Score</th>
            <th>Members</th><th>Flags</th><th>Last Seen</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([tw, uw]) => `
            <tr>
              <td>
                <div class="skel" style="width:${tw}px;height:13px;margin-bottom:5px"></div>
                <div class="skel" style="width:${uw}px;height:11px"></div>
              </td>
              <td><div class="skel" style="width:62px;height:20px;border-radius:99px"></div></td>
              <td><div class="skel" style="width:68px;height:13px"></div></td>
              <td><div class="skel" style="width:48px;height:13px"></div></td>
              <td><div class="skel" style="width:88px;height:13px"></div></td>
              <td><div class="skel" style="width:72px;height:13px"></div></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <div class="skel" style="width:120px;height:13px"></div>
      <div class="skel" style="width:64px;height:30px;border-radius:8px"></div>
      <div class="skel" style="width:64px;height:30px;border-radius:8px"></div>
    </div>`;
}

/* ── Utilities ──────────────────────────────────────────────── */
function parseFlags(flags) {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  try { return JSON.parse(flags); } catch { return []; }
}

function formatFlag(f) {
  return f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
