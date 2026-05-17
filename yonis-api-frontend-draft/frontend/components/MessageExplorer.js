import { fetchChannels, fetchChannel, fetchMessages } from "../api.js";

const MSG_PAGE = 50;

const KEYWORDS = [
  "nudify","undress","deepnude","ai nude","nude","naked","nsfw",
  "pay","payment","subscribe","bot","download","join","share",
  "telegram","link","channel","group",
];
const KW_RE = new RegExp(
  `(${KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})`,
  "gi"
);

/* ── CSV export ─────────────────────────────────────────────── */
function downloadCSV(rows, filename) {
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g,'""')}"`
      : s;
  };
  const headers = ["Timestamp","Channel","Text","Forwarded","Has Media","Keywords","Flags"];
  const lines = [
    headers.join(","),
    ...rows.map((m) => [
      m.timestamp ? new Date(m.timestamp).toISOString() : "",
      m.channel_username || m.channel_id || "",
      m.text || "",
      m.is_forwarded ? "Yes" : "No",
      m.has_media    ? "Yes" : "No",
      parseList(m.keyword_matches).join("; "),
      parseList(m.content_flags).join("; "),
    ].map(escape).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const EXPORT_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10V2M4 7l4 4 4-4M2 13h12"/></svg>`;

const RISK_LEVELS = ["all","high","medium","low","unclassified"];

/* ── Main render ────────────────────────────────────────────── */
export async function renderMessageExplorer(container, { initialChannelId } = {}) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Message Explorer</h1>
      <p>Browse raw messages for any channel — keyword matches are highlighted</p>
    </div>
    <div class="msg-shell">
      <div class="channel-picker">
        <input class="search-input" id="msg-ch-search" placeholder="Filter channels…" style="width:100%"/>

        <!-- Risk filter chips -->
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
          ${RISK_LEVELS.map((r) => `
            <button
              class="chip ${r === "all" ? "active" : ""}"
              data-risk-filter="${r}"
              style="padding:4px 10px;font-size:11px"
            >${r === "all" ? "All" : cap(r)}</button>`).join("")}
        </div>

        <div class="msg-section-label" style="margin-top:4px">Channels</div>
        <div class="channel-pick-list" id="ch-pick-list">
          ${channelListSkeletonHtml()}
        </div>
      </div>
      <div class="msg-panel">
        <div class="msg-header" id="msg-channel-header">
          <p style="color:var(--muted)">Select a channel on the left to browse its messages.</p>
        </div>
        <div class="msg-list-wrap" id="msg-list-wrap">
          <div class="empty-state">No channel selected.</div>
        </div>
      </div>
    </div>
  `;

  let allChannels   = [];
  let selectedId    = null;
  let selectedTitle = "";
  let msgOffset     = 0;
  let msgTotal      = 0;
  let activeRisk    = "all";   // client-side risk filter for channel list

  /* ── Load channel list ────────────────────────────────────── */
  try {
    const data = await fetchChannels({ limit: 500 });
    allChannels = data.channels;
  } catch {
    document.getElementById("ch-pick-list").innerHTML =
      `<div class="empty-state">API error — is the server running?</div>`;
    return;
  }

  renderChannelList();

  const autoId = initialChannelId ?? topChannel(allChannels)?.channel_id;
  if (autoId) selectChannel(autoId);

  /* ── Risk filter chips ────────────────────────────────────── */
  container.querySelectorAll("[data-risk-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeRisk = btn.dataset.riskFilter;
      container.querySelectorAll("[data-risk-filter]").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
      renderChannelList();
      // Re-highlight active channel in updated list
      if (selectedId) {
        const item = container.querySelector(`.channel-pick-item[data-id="${selectedId}"]`);
        if (item) item.classList.add("active");
      }
    });
  });

  /* ── Text search ──────────────────────────────────────────── */
  let timer;
  document.getElementById("msg-ch-search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderChannelList(e.target.value.toLowerCase());
      if (selectedId) {
        const item = container.querySelector(`.channel-pick-item[data-id="${selectedId}"]`);
        if (item) item.classList.add("active");
      }
    }, 200);
  });

  /* ── Render channel picker list ───────────────────────────── */
  function renderChannelList(searchQuery = "") {
    const list = document.getElementById("ch-pick-list");
    let filtered = allChannels;

    if (activeRisk !== "all") {
      filtered = filtered.filter((c) => c.risk_level === activeRisk);
    }
    if (searchQuery) {
      filtered = filtered.filter((c) =>
        (c.title    || "").toLowerCase().includes(searchQuery) ||
        (c.username || "").toLowerCase().includes(searchQuery)
      );
    }

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state" style="padding:16px">No channels found</div>`;
      return;
    }

    list.innerHTML = filtered.map((ch) => `
      <div class="channel-pick-item ${ch.channel_id === selectedId ? "active" : ""}" data-id="${esc(ch.channel_id)}">
        <div class="channel-pick-name">${esc(ch.title)}</div>
        <div class="channel-pick-meta">
          <span class="risk-${esc(ch.risk_level)}">${esc(ch.risk_level)}</span>
          ${ch.member_count != null ? ` · ${ch.member_count.toLocaleString()} members` : ""}
        </div>
      </div>`).join("");

    list.querySelectorAll(".channel-pick-item").forEach((item) => {
      item.addEventListener("click", () => selectChannel(item.dataset.id));
    });
  }

  /* ── Select a channel ─────────────────────────────────────── */
  async function selectChannel(id) {
    selectedId = id;
    msgOffset  = 0;

    container.querySelectorAll(".channel-pick-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.id === id)
    );

    const header  = document.getElementById("msg-channel-header");
    const msgWrap = document.getElementById("msg-list-wrap");
    header.innerHTML  = msgHeaderSkeletonHtml();
    msgWrap.innerHTML = msgListSkeletonHtml();

    let ch;
    try {
      ch = await fetchChannel(id);
    } catch {
      header.innerHTML = `<p style="color:var(--muted)">Could not load channel details.</p>`;
      return;
    }

    selectedTitle = ch.title || id;
    const flags   = parseFlags(ch.content_flags);

    header.innerHTML = `
      <div class="msg-header-top">
        <div>
          <h2>${esc(ch.title)}</h2>
          <div class="msg-header-meta" style="margin-top:6px">
            ${ch.username ? `<span style="font-family:monospace;color:var(--muted)">@${esc(ch.username)}</span>` : ""}
            <span class="risk-pill ${esc(ch.risk_level)}">${esc(ch.risk_level)}</span>
            ${ch.relevance_score != null ? `<span style="color:var(--muted)">Score: ${ch.relevance_score.toFixed(3)}</span>` : ""}
            ${ch.member_count != null    ? `<span style="color:var(--muted)">${ch.member_count.toLocaleString()} members</span>` : ""}
            ${flags.slice(0,4).map((f) => `<span class="flag-chip">${esc(formatFlag(f))}</span>`).join("")}
          </div>
        </div>
        <button class="btn btn-export" id="msg-export-btn" title="Export messages as CSV">
          ${EXPORT_ICON} Export CSV
        </button>
      </div>`;

    document.getElementById("msg-export-btn")?.addEventListener("click", handleExport);
    await loadMessages(id, false);
  }

  /* ── Load messages ────────────────────────────────────────── */
  async function loadMessages(id, append = false) {
    const msgWrap = document.getElementById("msg-list-wrap");
    if (!append) msgWrap.innerHTML = msgListSkeletonHtml();

    let data;
    try {
      data = await fetchMessages(id, { limit: MSG_PAGE, offset: msgOffset });
    } catch {
      if (!append) msgWrap.innerHTML = `<div class="empty-state">Failed to load messages.</div>`;
      return;
    }

    msgTotal      = data.total;
    const msgs    = data.messages;

    if (!append) {
      if (!msgs.length) {
        msgWrap.innerHTML = `<div class="empty-state">No messages collected for this channel.</div>`;
        return;
      }
      msgWrap.innerHTML = msgs.map((m) => msgHtml(m)).join("");
    } else {
      msgWrap.querySelector(".msg-load-more")?.remove();
      msgs.forEach((m) => {
        const div = document.createElement("div");
        div.innerHTML = msgHtml(m);
        msgWrap.appendChild(div.firstElementChild);
      });
    }

    if (msgOffset + msgs.length < msgTotal) {
      const btn = document.createElement("div");
      btn.className = "msg-load-more";
      btn.innerHTML = `<button class="btn" id="load-more-btn">Load more (${(msgTotal - msgOffset - msgs.length).toLocaleString()} remaining)</button>`;
      msgWrap.appendChild(btn);
      document.getElementById("load-more-btn").addEventListener("click", () => {
        msgOffset += MSG_PAGE;
        loadMessages(id, true);
      });
    }
  }

  /* ── Export handler — full paginated fetch ────────────────── */
  async function handleExport() {
    const btn = document.getElementById("msg-export-btn");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></span> Loading…`;

    try {
      const BATCH = 200;
      let all    = [];
      let offset = 0;
      let total  = Infinity;

      while (offset < total) {
        const data = await fetchMessages(selectedId, { limit: BATCH, offset });
        total  = data.total;
        all    = all.concat(data.messages);
        offset += data.messages.length;
        if (!data.messages.length) break;
        btn.innerHTML = `<span style="display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></span> ${all.length} / ${total}`;
      }

      if (all.length) {
        const safe = selectedTitle.replace(/[^a-z0-9]/gi,"_").toLowerCase();
        downloadCSV(all, `messages_${safe}_${new Date().toISOString().split("T")[0]}.csv`);
      }
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${EXPORT_ICON} Export CSV`;
    }
  }

  /* ── Message card HTML ────────────────────────────────────── */
  function msgHtml(m) {
    const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
    const text = m.text
      ? highlightKeywords(esc(m.text))
      : `<span style="color:var(--muted);font-style:italic">[no text]${m.has_media ? ` · media: ${m.media_type || "file"}` : ""}</span>`;
    const kw       = parseList(m.keyword_matches);
    const mentions = parseList(m.extracted_mentions);
    return `
      <div class="msg-item ${m.is_forwarded ? "forwarded" : ""}">
        <div class="msg-meta">
          <span class="msg-time">${time}</span>
          ${m.is_forwarded ? `<span class="fwd-badge">↩ Forwarded</span>` : ""}
          ${kw.length      ? `<span class="flag-chip">${kw.length} keyword${kw.length > 1 ? "s" : ""}</span>` : ""}
          ${mentions.length ? `<span class="flag-chip">${mentions.length} mention${mentions.length > 1 ? "s" : ""}</span>` : ""}
        </div>
        <div class="msg-text">${text}</div>
      </div>`;
  }

  function highlightKeywords(text) {
    return text.replace(KW_RE, (m) => `<span class="kw-highlight">${m}</span>`);
  }
}

/* ── Skeletons ──────────────────────────────────────────────── */
function channelListSkeletonHtml() {
  return [[130,70],[100,85],[150,60],[115,78],[140,90],[95,65],[125,82],[108,74]]
    .map(([tw,mw]) => `
      <div class="channel-pick-item">
        <div class="skel" style="width:${tw}px;height:13px;margin-bottom:5px"></div>
        <div class="skel" style="width:${mw}px;height:11px"></div>
      </div>`).join("");
}

function msgHeaderSkeletonHtml() {
  return `
    <div class="msg-header-top">
      <div>
        <div class="skel" style="width:180px;height:20px;margin-bottom:10px"></div>
        <div class="msg-header-meta">
          <div class="skel" style="width:90px;height:16px;border-radius:99px"></div>
          <div class="skel" style="width:56px;height:16px;border-radius:99px"></div>
          <div class="skel" style="width:74px;height:16px"></div>
        </div>
      </div>
      <div class="skel" style="width:110px;height:32px;border-radius:8px"></div>
    </div>`;
}

function msgListSkeletonHtml() {
  return [
    [[100,11],[280,13],[220,13],[160,13]],
    [[100,11],[240,13],[300,13]],
    [[100,11],[200,13],[260,13],[180,13]],
    [[100,11],[320,13],[140,13]],
    [[100,11],[260,13],[200,13],[240,13]],
  ].map((lines) => `
    <div class="msg-item">
      <div class="msg-meta" style="margin-bottom:8px">
        <div class="skel" style="width:${lines[0][0]}px;height:${lines[0][1]}px"></div>
      </div>
      ${lines.slice(1).map(([w,h]) =>
        `<div class="skel" style="width:${w}px;height:${h}px;margin-bottom:4px"></div>`
      ).join("")}
    </div>`).join("");
}

/* ── Utilities ──────────────────────────────────────────────── */
function parseFlags(flags) {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  try { return JSON.parse(flags); } catch { return []; }
}
function parseList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}
function formatFlag(f) {
  return f.replace(/_/g," ").replace(/\b\w/g,(c) => c.toUpperCase());
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

const RISK_RANK = { high:0, medium:1, low:2, unclassified:3 };
function topChannel(channels) {
  return [...channels].sort((a,b) => {
    const rd = (RISK_RANK[a.risk_level] ?? 4) - (RISK_RANK[b.risk_level] ?? 4);
    return rd !== 0 ? rd : (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
  })[0] ?? null;
}
