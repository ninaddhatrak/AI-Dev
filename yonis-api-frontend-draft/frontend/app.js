import { renderOverview }          from "./components/Overview.js";
import { renderChannelTable }      from "./components/ChannelTable.js";
import { renderNetworkGraphV1 }    from "./components/NetworkGraphV1.js";
import { renderMessageExplorer }   from "./components/MessageExplorer.js";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  view: "overview",
  pendingChannelId: null,   // used when navigating to messages with a pre-selected channel
};

// ── View registry ──────────────────────────────────────────────────────────
const views = {
  overview: { el: null, render: (el) => renderOverview(el) },
  channels: {
    el: null,
    render: (el) => renderChannelTable(el, {
      onSelectChannel: (id) => navigateTo("messages", id),
    }),
  },
  network: {
    el: null,
    render: (el) => renderNetworkGraphV1(el, {
      onSelectChannel: (id) => navigateTo("messages", id),
    }),
  },
  messages: {
    el: null,
    render: (el) => renderMessageExplorer(el, {
      initialChannelId: state.pendingChannelId,
    }),
  },
};

// ── Router ─────────────────────────────────────────────────────────────────
function navigateTo(viewName, channelId = null) {
  if (!(viewName in views)) return;

  state.pendingChannelId = channelId;

  // Update nav
  document.querySelectorAll(".nav-link").forEach(a =>
    a.classList.toggle("active", a.dataset.view === viewName)
  );

  // Hide all views, show target
  Object.keys(views).forEach(name => {
    const el = document.getElementById(`view-${name}`);
    if (!el) return;
    const active = name === viewName;
    el.classList.toggle("active", active);
    views[name].el = el;
  });

  const container = views[viewName].el;

  // Re-render on each navigation so data stays fresh,
  // except the network graphs (expensive) — keep if already rendered
  if (viewName === "network" && container.dataset.rendered === "1" && !channelId) {
    return;
  }

  views[viewName].render(container);

  if (viewName === "network") container.dataset.rendered = "1";

  state.view = viewName;
}

// ── Init ───────────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-link").forEach(a => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo(a.dataset.view);
  });
});

// Handle hash on load (e.g. index.html#channels)
const hash = location.hash.replace("#", "");
navigateTo(hash in views ? hash : "overview");
