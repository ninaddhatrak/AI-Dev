import { fetchChannels } from "../api.js";

const PAGE_SIZE = 50;

export async function renderChannelTable(container, { onSelectChannel } = {}) {
  let state = { riskLevel: "all", search: "", offset: 0, total: 0, channels: [] };

  function toolbar() {
    return `
      <div class="toolbar">
        <input class="search-input" id="ch-search" placeholder="Search by name or @username…" value="${state.search}" />
        <div class="filter-chips">
          ${["all","high","medium","low","unclassified"].map(r => `
            <button class="chip ${state.riskLevel === r ? "active" : ""}" data-risk="${r}">
              ${r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
            </button>`).join("")}
        </div>
      </div>`;
  }

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
            ${state.channels.map(ch => channelRow(ch)).join("")}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>${state.offset + 1}–${Math.min(state.offset + state.channels.length, state.total)} of ${state.total}</span>
        <button class="btn" id="ch-prev" ${state.offset === 0 ? "disabled" : ""}>&#8592; Prev</button>
        <button class="btn" id="ch-next" ${state.offset + state.channels.length >= state.total ? "disabled" : ""}>Next &#8594;</button>
      </div>`;
  }

  function channelRow(ch) {
    const score = ch.relevance_score != null ? ch.relevance_score.toFixed(2) : null;
    const flags = parseFlags(ch.content_flags);
    const lastSeen = ch.last_seen ? new Date(ch.last_seen).toLocaleDateString() : "—";
    return `
      <tr data-id="${ch.channel_id}">
        <td>
          <div style="font-weight:600">${esc(ch.title)}</div>
          ${ch.username ? `<div style="color:var(--muted);font-size:11px">@${esc(ch.username)}</div>` : ""}
        </td>
        <td><span class="risk-pill ${ch.risk_level}">${ch.risk_level}</span></td>
        <td>
          ${score != null
            ? `<div class="score-bar-wrap">
                <div class="score-bar" style="width:${Math.round(ch.relevance_score * 60)}px"></div>
                <span style="font-size:12px;color:var(--muted)">${score}</span>
               </div>`
            : `<span style="color:var(--muted)">—</span>`}
        </td>
        <td>${ch.member_count != null ? ch.member_count.toLocaleString() : "—"}</td>
        <td>${flags.map(f => `<span class="flag-chip">${formatFlag(f)}</span>`).join("") || "—"}</td>
        <td style="color:var(--muted);font-size:12px">${lastSeen}</td>
      </tr>`;
  }

  async function load() {
    container.querySelector("#ch-table-area").innerHTML =
      `<div class="loading"><div class="loading-spinner"></div>Loading…</div>`;
    try {
      const data = await fetchChannels({
        riskLevel: state.riskLevel,
        search: state.search,
        limit: PAGE_SIZE,
        offset: state.offset,
      });
      state.channels = data.channels;
      state.total = data.total;
    } catch {
      container.querySelector("#ch-table-area").innerHTML =
        `<div class="empty-state">API error — is the server running?</div>`;
      return;
    }
    container.querySelector("#ch-table-area").innerHTML = tableHtml();
    bindTableEvents();
  }

  function bindTableEvents() {
    container.querySelector("#ch-prev")?.addEventListener("click", () => {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      load();
    });
    container.querySelector("#ch-next")?.addEventListener("click", () => {
      state.offset += PAGE_SIZE;
      load();
    });
    container.querySelectorAll("tbody tr").forEach(row => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        if (onSelectChannel) onSelectChannel(id);
      });
    });
  }

  // Initial render
  container.innerHTML = `
    <div class="page-header">
      <h1>Channels</h1>
      <p>All ${PAGE_SIZE > 0 ? "" : ""}scraped channels — click a row to browse messages</p>
    </div>
    ${toolbar()}
    <div id="ch-table-area"><div class="loading"><div class="loading-spinner"></div>Loading…</div></div>
  `;

  // Chip filter
  container.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.riskLevel = btn.dataset.risk;
      state.offset = 0;
      container.querySelectorAll(".chip").forEach(b => b.classList.toggle("active", b === btn));
      load();
    });
  });

  // Search debounce
  let searchTimer;
  container.querySelector("#ch-search").addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.offset = 0;
      load();
    }, 300);
  });

  await load();
}

function parseFlags(flags) {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  try { return JSON.parse(flags); } catch { return []; }
}

function formatFlag(f) {
  return f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
