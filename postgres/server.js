const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || (process.env.NODE_ENV === 'production' ? 'postgres' : 'localhost'),
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'harm_tracker',
  user: process.env.DB_USER || 'tracker',
  password: process.env.DB_PASSWORD || 'tracker_pw',
});

// Test database connection
pool.query('SELECT NOW()')
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch(err => console.error('❌ Database connection error:', err.message));

// ============ API ENDPOINTS ============

// GET /api/stats - Aggregate statistics
app.get('/api/stats', async (req, res) => {
  try {
    const stats = {};

    // Channel stats
    const channelResult = await pool.query(`
      SELECT 
        COUNT(*) as total_channels,
        COUNT(*) FILTER (WHERE risk_level = 'high' OR risk_level = 'critical') as high_risk,
        COUNT(*) FILTER (WHERE risk_level = 'medium') as medium_risk,
        COUNT(*) FILTER (WHERE risk_level = 'low') as low_risk,
        COUNT(*) FILTER (WHERE risk_level = 'unclassified') as unclassified_risk,
        COUNT(*) FILTER (WHERE is_active = true) as active_channels,
        SUM(COALESCE(member_count, 0)) as total_subscribers
      FROM channels
    `);
    const cr = channelResult.rows[0];
    stats.totalChannels = parseInt(cr.total_channels) || 0;
    stats.highRisk = parseInt(cr.high_risk) || 0;
    stats.mediumRisk = parseInt(cr.medium_risk) || 0;
    stats.lowRisk = parseInt(cr.low_risk) || 0;
    stats.unclassifiedRisk = parseInt(cr.unclassified_risk) || 0;
    stats.activeChannels = parseInt(cr.active_channels) || 0;
    stats.totalSubscribers = parseInt(cr.total_subscribers) || 0;

    // Message stats
    const messageResult = await pool.query(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(*) FILTER (WHERE is_forwarded = true) as forwarded_messages
      FROM messages
    `);
    const mr = messageResult.rows[0];
    stats.totalMessages = parseInt(mr.total_messages) || 0;
    stats.forwardedMessages = parseInt(mr.forwarded_messages) || 0;

    // Edge stats
    const edgeResult = await pool.query(`SELECT COUNT(*) as total_edges FROM edges`);
    stats.totalEdges = parseInt(edgeResult.rows[0].total_edges) || 0;

    // Keyword stats
    const kwResult = await pool.query(`SELECT COUNT(*) as total_keywords FROM keywords`);
    stats.totalKeywords = parseInt(kwResult.rows[0].total_keywords) || 0;

    // Content Flags aggregation
    const flagsResult = await pool.query(`
      SELECT flag, COUNT(*) as cnt
      FROM channels, jsonb_array_elements_text(content_flags) AS flag
      GROUP BY flag ORDER BY cnt DESC
    `);
    stats.contentFlags = flagsResult.rows.map(r => ({ flag: r.flag, count: parseInt(r.cnt) }));

    // Top Mentions
    const mentionsResult = await pool.query(`
      SELECT mention, COUNT(*) as cnt
      FROM messages, jsonb_array_elements_text(extracted_mentions) AS mention
      GROUP BY mention ORDER BY cnt DESC LIMIT 8
    `);
    stats.topMentions = mentionsResult.rows.map(r => ({ mention: r.mention, count: parseInt(r.cnt) }));

    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/channels - List all channels with optional filtering
app.get('/api/channels', async (req, res) => {
  try {
    const { risk, search, limit = 500, offset = 0 } = req.query;

    let query = `
      SELECT 
        channel_id,
        username,
        title,
        channel_type,
        member_count,
        discovered_at,
        last_activity,
        risk_level,
        is_active,
        relevance_score,
        is_dead_end,
        content_flags,
        discovery_method
      FROM channels
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (risk && risk !== 'all') {
      query += ` AND risk_level = $${paramIndex}`;
      params.push(risk);
      paramIndex++;
    }

    if (search) {
      query += ` AND (title ILIKE $${paramIndex} OR username ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY member_count DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Transform to match dashboard expected format
    const channels = result.rows.map(c => ({
      channel_id: c.channel_id,
      username: c.username,
      title: c.title,
      name: c.username ? `@${c.username}` : (c.title || `@${c.channel_id}`),
      category: c.channel_type || 'Uncategorized',
      subs: c.member_count || 0,
      created: c.discovered_at ? new Date(c.discovered_at).toLocaleString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown',
      lastActive: c.last_activity ? getTimeAgo(c.last_activity) : 'Unknown',
      risk: c.risk_level?.toLowerCase() || 'medium',
      status: c.is_active ? 'Active' : 'Banned',
      relevance_score: c.relevance_score != null ? Number(c.relevance_score) : null,
      is_dead_end: c.is_dead_end,
      content_flags: c.content_flags || [],
      discovery_method: c.discovery_method || 'unknown'
    }));

    res.json(channels);
  } catch (err) {
    console.error('Channels error:', err.message);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// GET /api/channels/:channel_id - Get single channel details
app.get('/api/channels/:channel_id', async (req, res) => {
  try {
    const { channel_id } = req.params;
    const result = await pool.query(`
      SELECT 
        channel_id, username, title, channel_type, description, 
        member_count, discovered_at, last_activity, risk_level, 
        is_active, relevance_score, is_dead_end, content_flags, discovery_method
      FROM channels
      WHERE channel_id = $1 OR username = $1
    `, [channel_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    
    const c = result.rows[0];
    res.json({
      channel_id: c.channel_id,
      username: c.username,
      title: c.title,
      channel_type: c.channel_type || 'Uncategorized',
      description: c.description || '',
      member_count: c.member_count || 0,
      discovered_at: c.discovered_at,
      last_activity: c.last_activity,
      risk_level: c.risk_level?.toLowerCase() || 'medium',
      is_active: c.is_active,
      relevance_score: c.relevance_score != null ? Number(c.relevance_score) : null,
      is_dead_end: c.is_dead_end,
      content_flags: c.content_flags || [],
      discovery_method: c.discovery_method || 'unknown'
    });
  } catch (err) {
    console.error('Get channel error:', err.message);
    res.status(500).json({ error: 'Failed to fetch channel details' });
  }
});


// GET /api/keywords - Keyword frequency data
app.get('/api/keywords', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        keyword,
        category,
        language,
        channels_discovered,
        messages_matched,
        added_at,
        source,
        COALESCE(messages_matched, 0) * 1.25 + COALESCE(channels_discovered, 0) * 0.75 AS score,
        (added_at IS NOT NULL AND added_at > NOW() - INTERVAL '30 days') AS is_new
      FROM keywords
      WHERE is_active = true
      ORDER BY score DESC, messages_matched DESC, channels_discovered DESC
      LIMIT 50
    `);

    const maxScore = Math.max(...result.rows.map(r => Number(r.score) || 0), 1);
    const keywords = result.rows.map(k => {
      const scoreValue = Number(k.score) || 0;
      return {
        term: k.keyword,
        category: k.category || 'Other',
        language: k.language || 'en',
        count: k.messages_matched || 0,
        channels_discovered: k.channels_discovered || 0,
        score: Number(scoreValue.toFixed(2)),
        pct: maxScore > 0 ? Math.round((scoreValue / maxScore) * 100) : 0,
        is_new: k.is_new || false,
        added_at: k.added_at,
        source: k.source || 'manual'
      };
    });

    res.json(keywords);
  } catch (err) {
    console.error('Keywords error:', err.message);
    res.status(500).json({ error: 'Failed to fetch keywords' });
  }
});

// GET /api/network - Network graph data (nodes + edges)
app.get('/api/network', async (req, res) => {
  try {
    const nodesResult = await pool.query(`
      SELECT
        channel_id,
        username,
        title,
        channel_type,
        member_count,
        risk_level,
        COALESCE(relevance_score::double precision, NULL) AS relevance_score,
        content_flags,
        discovered_at,
        (discovered_at >= NOW() - INTERVAL '21 days') AS is_recent
      FROM channels
      ORDER BY member_count DESC
    `);

    const edgesResult = await pool.query(`
      WITH stored_edges AS (
        SELECT source_channel_id, target_channel_id, COALESCE(weight, 1) AS weight, edge_type
        FROM edges
      ), forwarded AS (
        SELECT
          m.channel_id AS source_channel_id,
          c.channel_id AS target_channel_id,
          COUNT(*) AS weight,
          'forward' AS edge_type
        FROM messages m
        JOIN channels c ON REPLACE(REPLACE(m.forward_from_channel_id, '-100', ''), '-', '') = c.channel_id
        WHERE m.forward_from_channel_id IS NOT NULL
        GROUP BY m.channel_id, c.channel_id
      ), linked AS (
        SELECT
          c1.channel_id AS source_channel_id,
          c2.channel_id AS target_channel_id,
          1 AS weight,
          'linked' AS edge_type
        FROM channels c1
        CROSS JOIN LATERAL jsonb_array_elements_text(c1.linked_channels) AS raw_link
        JOIN channels c2 ON REPLACE(REPLACE(raw_link, '-100', ''), '-', '') = c2.channel_id OR REPLACE(raw_link, '@', '') = c2.username
        WHERE jsonb_typeof(c1.linked_channels) = 'array'
      ), mentions AS (
        SELECT
          m.channel_id AS source_channel_id,
          c.channel_id AS target_channel_id,
          COUNT(*) AS weight,
          'mention' AS edge_type
        FROM messages m
        CROSS JOIN LATERAL jsonb_array_elements_text(m.extracted_mentions) AS raw_mention
        JOIN channels c ON REPLACE(raw_mention, '@', '') = c.username
        WHERE jsonb_typeof(m.extracted_mentions) = 'array'
        GROUP BY m.channel_id, c.channel_id
      )
      SELECT * FROM stored_edges
      UNION ALL
      SELECT * FROM forwarded
      UNION ALL
      SELECT * FROM linked
      UNION ALL
      SELECT * FROM mentions
      ORDER BY weight DESC
    `);

    const nodeMap = new Map(nodesResult.rows.map(n => [n.channel_id, n]));
    const nodes = nodesResult.rows.map(n => ({
      channel_id: n.channel_id,
      username: n.username,
      title: n.title,
      category: n.channel_type || 'General / Other',
      member_count: n.member_count || 0,
      risk_level: n.risk_level?.toLowerCase() || 'unclassified',
      relevance_score: n.relevance_score != null ? Number(n.relevance_score) : null,
      content_flags: n.content_flags,
      discovered_at: n.discovered_at,
      is_recent: n.is_recent
    }));

    const edges = edgesResult.rows
      .filter(e => nodeMap.has(e.source_channel_id) && nodeMap.has(e.target_channel_id))
      .map(e => ({
        source_channel_id: e.source_channel_id,
        target_channel_id: e.target_channel_id,
        weight: e.weight || 1,
        edge_type: e.edge_type || 'link'
      }));

    res.json({ nodes, edges });
  } catch (err) {
    console.error('Network error:', err.message);
    res.status(500).json({ error: 'Failed to fetch network data' });
  }
});

// GET /api/actors - List all actors with stats
app.get('/api/actors', async (req, res) => {
  try {
    const { limit, offset = 0 } = req.query;
    const countResult = await pool.query(`SELECT COUNT(*) AS total_actors FROM actors`);
    const totalActors = parseInt(countResult.rows[0].total_actors, 10) || 0;

    let query = `
      SELECT 
        actor_id,
        channels_active_in,
        first_seen,
        last_seen,
        message_count,
        posting_frequency,
        typical_post_times,
        content_flags,
        cross_channel_posts,
        channels_administered,
        risk_level,
        risk_signals,
        dataset
      FROM actors
      ORDER BY message_count DESC
    `;
    const params = [];
    if (limit) {
      params.push(parseInt(limit));
      params.push(parseInt(offset));
      query += ` LIMIT $1 OFFSET $2`;
    }

    const result = await pool.query(query, params);
    res.json({ total: totalActors, actors: result.rows });
  } catch (err) {
    console.error('Error fetching actors:', err);
    res.status(500).json({ error: 'Failed to fetch actors' });
  }
});

// GET /api/messages - List all messages with channel info
app.get('/api/messages', async (req, res) => {
  try {
    const { limit = 500, offset = 0, channel_id } = req.query;
    
    let countQuery = `SELECT COUNT(*) AS total_messages FROM messages`;
    let countParams = [];
    if (channel_id) {
      countQuery += ` WHERE channel_id = $1`;
      countParams.push(channel_id);
    }
    const countResult = await pool.query(countQuery, countParams);
    const totalMessages = parseInt(countResult.rows[0].total_messages, 10) || 0;

    let query = `
      SELECT 
        m.message_id,
        m.text,
        m.timestamp,
        m.is_forwarded,
        m.has_media,
        m.media_type,
        m.content_flags,
        m.keyword_matches,
        m.extracted_mentions,
        c.username,
        c.channel_id,
        c.risk_level
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
    `;
    const params = [parseInt(limit), parseInt(offset)];
    let paramIndex = 3;
    if (channel_id) {
      query += ` WHERE m.channel_id = $${paramIndex}`;
      params.push(channel_id);
      paramIndex++;
    }
    query += ` ORDER BY m.timestamp DESC LIMIT $1 OFFSET $2`;

    const result = await pool.query(query, params);

    const messages = result.rows.map(m => ({
      message_id: m.message_id,
      channel: m.username ? `@${m.username}` : `@${m.channel_id}`,
      channel_id: m.channel_id,
      text: m.text || '',
      time: getTimeAgo(m.timestamp),
      timestamp: m.timestamp,
      risk: m.risk_level?.toLowerCase() || 'medium',
      flagged: Array.isArray(m.content_flags) ? m.content_flags.length > 0 : (m.content_flags && m.content_flags !== '[]'),
      forwarded: m.is_forwarded,
      media: m.has_media,
      media_type: m.media_type,
      keyword_matches: m.keyword_matches,
      extracted_mentions: m.extracted_mentions
    }));

    res.json({ total: totalMessages, messages });
  } catch (err) {
    console.error('Messages error:', err.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/timeline - Key events timeline
app.get('/api/timeline', async (req, res) => {
  try {
    // Use discovery dates and major events from channels table
    const result = await pool.query(`
      SELECT 
        title,
        discovered_at,
        risk_level,
        channel_type
      FROM channels
      WHERE discovered_at IS NOT NULL
      ORDER BY discovered_at DESC
      LIMIT 20
    `);

    const timeline = result.rows.map(r => ({
      date: r.discovered_at,
      title: r.title,
      description: `${r.channel_type} channel discovered`,
      type: r.risk_level?.toLowerCase() === 'critical' ? 'danger' :
        r.risk_level?.toLowerCase() === 'high' ? 'warn' : 'info'
    }));

    res.json(timeline);
  } catch (err) {
    console.error('Timeline error:', err.message);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// GET /api/export/channels - Export full channel list as CSV
app.get('/api/export/channels', async (req, res) => {
  try {
    const { risk, search, category, start, end } = req.query;
    let query = `
      SELECT 
        channel_id, username, title, channel_type, member_count, 
        discovered_at, last_activity, risk_level, is_active 
      FROM channels 
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (risk && risk !== 'all') {
      query += ` AND risk_level = $${paramIndex++}`;
      params.push(risk);
    }
    if (search) {
      query += ` AND (title ILIKE $${paramIndex} OR username ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (category) {
      query += ` AND (channel_type ILIKE $${paramIndex} OR title ILIKE $${paramIndex})`;
      params.push(`%${category}%`);
      paramIndex++;
    }
    if (start) {
      query += ` AND discovered_at >= $${paramIndex++}`;
      params.push(start);
    }
    if (end) {
      query += ` AND discovered_at <= $${paramIndex++}`;
      params.push(end);
    }

    query += ` ORDER BY member_count DESC`;
    const result = await pool.query(query, params);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="signalforge_channels_${new Date().toISOString().split('T')[0]}.csv"`);

    let csv = 'Channel ID,Username,Title,Type,Subscribers,Discovered,Last Activity,Risk,Status\n';
    for (const r of result.rows) {
      csv += [
        csvEscape(r.channel_id),
        csvEscape(r.username),
        csvEscape(r.title),
        csvEscape(r.channel_type),
        csvEscape(r.member_count),
        csvEscape(r.discovered_at ? r.discovered_at.toISOString() : ''),
        csvEscape(r.last_activity ? r.last_activity.toISOString() : ''),
        csvEscape(r.risk_level),
        r.is_active ? 'Active' : 'Banned'
      ].join(',') + '\n';
    }
    res.send(csv);
  } catch (err) {
    console.error('Export channels error:', err.message);
    res.status(500).json({ error: 'Failed to export channels' });
  }
});

// GET /api/export/messages - Export full message list as CSV
app.get('/api/export/messages', async (req, res) => {
  try {
    const { channel, start, end, flagged } = req.query;
    let query = `
      SELECT 
        m.text, m.timestamp, m.is_forwarded, m.has_media, 
        c.username, c.channel_id, c.risk_level, m.content_flags
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (channel) {
      query += ` AND (c.username ILIKE $${paramIndex} OR c.channel_id ILIKE $${paramIndex})`;
      params.push(`%${channel}%`);
      paramIndex++;
    }
    if (start) {
      query += ` AND m.timestamp >= $${paramIndex++}`;
      params.push(start);
    }
    if (end) {
      query += ` AND m.timestamp <= $${paramIndex++}`;
      params.push(end);
    }
    if (flagged === 'true') {
      query += ` AND (jsonb_array_length(m.content_flags) > 0 OR m.content_flags IS NOT NULL)`;
    }

    query += ` ORDER BY m.timestamp DESC`;
    const result = await pool.query(query, params);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="signalforge_messages_${new Date().toISOString().split('T')[0]}.csv"`);

    let csv = 'Channel,Text,Timestamp,Risk,Forwarded,Media,Flags\n';
    for (const r of result.rows) {
      const flags = Array.isArray(r.content_flags) ? r.content_flags.join('; ') : '';
      csv += [
        csvEscape(r.username || r.channel_id),
        csvEscape(r.text),
        csvEscape(r.timestamp ? r.timestamp.toISOString() : ''),
        csvEscape(r.risk_level),
        r.is_forwarded ? 'Yes' : 'No',
        r.has_media ? 'Yes' : 'No',
        csvEscape(flags)
      ].join(',') + '\n';
    }
    res.send(csv);
  } catch (err) {
    console.error('Export messages error:', err.message);
    res.status(500).json({ error: 'Failed to export messages' });
  }
});

// GET /api/cluster-explorer - Serve channel_clusters.json for the cluster explorer UI
app.get('/api/cluster-explorer', (req, res) => {
  const filePath = path.join(__dirname, 'channel_clusters.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('cluster-explorer: could not read channel_clusters.json:', err.message);
      return res.status(404).json({ error: 'channel_clusters.json not found' });
    }
    try {
      res.json(JSON.parse(data));
    } catch (parseErr) {
      console.error('cluster-explorer: JSON parse error:', parseErr.message);
      res.status(500).json({ error: 'Failed to parse channel_clusters.json' });
    }
  });
});

// GET /api/health - Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ============ HELPER FUNCTIONS ============

function getTimeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SignalForge API running on port ${PORT}`);
});