const API = "http://localhost:8888";

export async function fetchStats() {
  const r = await fetch(`${API}/stats`);
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json();
}

export async function fetchChannels({ riskLevel, search, limit = 200, offset = 0 } = {}) {
  const p = new URLSearchParams({ limit, offset });
  if (riskLevel && riskLevel !== "all") p.set("risk_level", riskLevel);
  if (search) p.set("search", search);
  const r = await fetch(`${API}/channels?${p}`);
  if (!r.ok) throw new Error("Failed to fetch channels");
  return r.json();
}

export async function fetchChannel(id) {
  const r = await fetch(`${API}/channels/${id}`);
  if (!r.ok) throw new Error("Channel not found");
  return r.json();
}

export async function fetchMessages(channelId, { limit = 50, offset = 0 } = {}) {
  const p = new URLSearchParams({ limit, offset });
  const r = await fetch(`${API}/channels/${channelId}/messages?${p}`);
  if (!r.ok) throw new Error("Failed to fetch messages");
  return r.json();
}

export async function fetchGraph(minWeight = 1) {
  const r = await fetch(`${API}/graph?min_weight=${minWeight}`);
  if (!r.ok) throw new Error("Failed to fetch graph");
  return r.json();
}
