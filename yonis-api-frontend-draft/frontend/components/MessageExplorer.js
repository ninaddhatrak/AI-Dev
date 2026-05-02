import { fetchChannels, fetchChannel, fetchMessages } from "../api.js";

const MSG_PAGE = 50;

// Known harm-related keywords to highlight
const KEYWORDS = [
  "nudify","undress","deepnude","ai nude","nude","naked","nsfw",
  "pay","payment","subscribe","bot","download","join","share",
  "telegram","link","channel","group",
];
const KW_RE = new RegExp(`(${KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})`, "gi");

export async function renderMessageExplorer(container, { initialChannelId } = {}) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Message Explorer</h1>
      <p>Browse raw messages for any channel — keyword matches are highlighted</p>
    </div>
    <div class="msg-shell">
      <div class="channel-picker">
        <input class="search-input" id="msg-ch-search" placeholder="Filter channels…" style="width:100%" />
        <div class="channel-pick-list" id="ch-pick-list">
          <div class="loading"><div class="loading-spinner"></div></div>
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

  let allChannels = [];
  let selectedId = null;
  let msgOffset = 0;
  let msgTotal = 0;

  // Load channel list
  try {
    const data = await fetchChannels({ limit: 500 });
    allChannels = data.channels;
  } catch {
    document.getElementById("ch-pick-list").innerHTML =
      `<div class="empty-state">API error</div>`;
    return;
  }

  renderChannelList(allChannels);

  // If navigated from another view
  if (initialChannelId) {
    selectChannel(initialChannelId);
  }

  // Search filter
  let timer;
  document.getElementById("msg-ch-search").addEventListener("input", e => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = e.target.value.toLowerCase();
      const filtered = q
        ? allChannels.filter(c =>
            (c.title || "").toLowerCase().includes(q) ||
            (c.username || "").toLowerCase().includes(q))
        : allChannels;
      renderChannelList(filtered);
      if (selectedId) {
        const item = document.querySelector(`.channel-pick-item[data-id="${selectedId}"]`);
        if (item) item.classList.add("active");
      }
    }, 200);
  });

  function renderChannelList(channels) {
    const list = document.getElementById("ch-pick-list");
    if (!channels.length) {
      list.innerHTML = `<div class="empty-state" style="padding:16px">No channels found</div>`;
      return;
    }
    list.innerHTML = channels.map(ch => `
      <div class="channel-pick-item ${ch.channel_id === selectedId ? "active" : ""}" data-id="${ch.channel_id}">
        <div class="channel-pick-name">${esc(ch.title)}</div>
        <div class="channel-pick-meta">
          <span class="risk-${ch.risk_level}">${ch.risk_level}</span>
          ${ch.member_count != null ? ` · ${ch.member_count.toLocaleString()} members` : ""}
        </div>
      </div>
    `).join("");

    list.querySelectorAll(".channel-pick-item").forEach(item => {
      item.addEventListener("click", () => selectChannel(item.dataset.id));
    });
  }

  async function selectChannel(id) {
    selectedId = id;
    msgOffset = 0;

    // highlight
    document.querySelectorAll(".channel-pick-item").forEach(el =>
      el.classList.toggle("active", el.dataset.id === id)
    );

    // header
    const header = document.getElementById("msg-channel-header");
    header.innerHTML = `<div class="loading"><div class="loading-spinner"></div></div>`;

    const msgWrap = document.getElementById("msg-list-wrap");
    msgWrap.innerHTML = `<div class="loading"><div class="loading-spinner"></div>Loading messages…</div>`;

    let ch;
    try {
      ch = await fetchChannel(id);
    } catch {
      header.innerHTML = `<p style="color:var(--muted)">Could not load channel details.</p>`;
      return;
    }

    const flags = parseFlags(ch.content_flags);
    header.innerHTML = `
      <h2>${esc(ch.title)}</h2>
      <div class="msg-header-meta">
        ${ch.username ? `<span style="font-family:monospace">@${esc(ch.username)}</span>` : ""}
        <span class="risk-pill ${ch.risk_level}">${ch.risk_level}</span>
        ${ch.relevance_score != null ? `<span>Score: ${ch.relevance_score.toFixed(3)}</span>` : ""}
        ${ch.member_count != null ? `<span>${ch.member_count.toLocaleString()} members</span>` : ""}
        ${flags.map(f => `<span class="flag-chip">${formatFlag(f)}</span>`).join("")}
      </div>
    `;

    await loadMessages(id, false);
  }

  async function loadMessages(id, append = false) {
    const msgWrap = document.getElementById("msg-list-wrap");
    if (!append) {
      msgWrap.innerHTML = `<div class="loading"><div class="loading-spinner"></div>Loading messages…</div>`;
    }

    let data;
    try {
      data = await fetchMessages(id, { limit: MSG_PAGE, offset: msgOffset });
    } catch {
      if (!append) msgWrap.innerHTML = `<div class="empty-state">Failed to load messages.</div>`;
      return;
    }

    msgTotal = data.total;
    const msgs = data.messages;

    if (!append) {
      if (!msgs.length) {
        msgWrap.innerHTML = `<div class="empty-state">No messages collected for this channel.</div>`;
        return;
      }
      msgWrap.innerHTML = msgs.map(m => msgHtml(m)).join("");
    } else {
      // Remove old load-more btn
      msgWrap.querySelector(".msg-load-more")?.remove();
      msgs.forEach(m => {
        const div = document.createElement("div");
        div.innerHTML = msgHtml(m);
        msgWrap.appendChild(div.firstElementChild);
      });
    }

    // Load more button
    if (msgOffset + msgs.length < msgTotal) {
      const btn = document.createElement("div");
      btn.className = "msg-load-more";
      btn.innerHTML = `<button class="btn" id="load-more-btn">Load more (${msgTotal - msgOffset - msgs.length} remaining)</button>`;
      msgWrap.appendChild(btn);
      document.getElementById("load-more-btn").addEventListener("click", () => {
        msgOffset += MSG_PAGE;
        loadMessages(id, true);
      });
    }
  }

  function msgHtml(m) {
    const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
    const text = m.text ? highlightKeywords(esc(m.text)) : `<span style="color:var(--muted);font-style:italic">[no text]${m.has_media ? ` · media: ${m.media_type || "file"}` : ""}</span>`;
    const kwMatches = parseList(m.keyword_matches);
    const mentions  = parseList(m.extracted_mentions);
    return `
      <div class="msg-item ${m.is_forwarded ? "forwarded" : ""}">
        <div class="msg-meta">
          <span class="msg-time">${time}</span>
          ${m.is_forwarded ? `<span class="fwd-badge">Forwarded</span>` : ""}
          ${kwMatches.length ? `<span class="flag-chip">${kwMatches.length} keyword${kwMatches.length > 1 ? "s" : ""}</span>` : ""}
          ${mentions.length ? `<span class="flag-chip">${mentions.length} mention${mentions.length > 1 ? "s" : ""}</span>` : ""}
        </div>
        <div class="msg-text">${text}</div>
      </div>
    `;
  }

  function highlightKeywords(text) {
    return text.replace(KW_RE, m => `<span class="kw-highlight">${m}</span>`);
  }
}

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
  return f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
