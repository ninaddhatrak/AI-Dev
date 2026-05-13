const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

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
    const { risk, search, limit = 100, offset = 0 } = req.query;
    
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
        is_active
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
      name: c.username || `@${c.channel_id}`,
      category: c.channel_type || 'Uncategorized',
      subs: c.member_count || 0,
      created: c.discovered_at ? new Date(c.discovered_at).toLocaleString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown',
      lastActive: c.last_activity ? getTimeAgo(c.last_activity) : 'Unknown',
      risk: c.risk_level?.toLowerCase() || 'medium',
      status: c.is_active ? 'Active' : 'Banned'
    }));

    res.json(channels);
  } catch (err) {
    console.error('Channels error:', err.message);
    res.status(500).json({ error: 'Failed to fetch channels' });
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

    const maxScore = Math.max(...result.rows.map(r => r.score || 0), 1);
    const keywords = result.rows.map(k => ({
      term: k.keyword,
      category: k.category || 'Other',
      language: k.language || 'en',
      count: k.messages_matched || 0,
      channels_discovered: k.channels_discovered || 0,
      score: Number((k.score || 0).toFixed(2)),
      pct: maxScore > 0 ? Math.round((k.score / maxScore) * 100) : 0,
      is_new: k.is_new || false,
      added_at: k.added_at,
      source: k.source || 'manual'
    }));

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
          channel_id AS source_channel_id,
          forward_from_channel_id AS target_channel_id,
          COUNT(*) AS weight,
          'forward' AS edge_type
        FROM messages
        WHERE forward_from_channel_id IS NOT NULL
        GROUP BY channel_id, forward_from_channel_id
      ), linked AS (
        SELECT
          channel_id AS source_channel_id,
          jsonb_array_elements_text(linked_channels) AS target_channel_id,
          1 AS weight,
          'linked' AS edge_type
        FROM channels
        WHERE jsonb_typeof(linked_channels) = 'array'
      ), mentions AS (
        SELECT
          channel_id AS source_channel_id,
          jsonb_array_elements_text(extracted_mentions) AS target_channel_id,
          COUNT(*) AS weight,
          'mention' AS edge_type
        FROM messages
        WHERE jsonb_typeof(extracted_mentions) = 'array'
        GROUP BY channel_id, target_channel_id
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
    const result = await pool.query(`
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
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching actors:', err);
    res.status(500).json({ error: 'Failed to fetch actors' });
  }
});

// GET /api/messages - List all messages with channel info
app.get('/api/messages', async (req, res) => {
  try {
    const { limit = 20000, offset = 0 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        m.text,
        m.timestamp,
        m.is_forwarded,
        m.has_media,
        m.content_flags,
        c.username,
        c.channel_id,
        c.risk_level
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      ORDER BY m.timestamp DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);
    
    const messages = result.rows.map(m => ({
      channel: m.username ? `@${m.username}` : `@${m.channel_id}`,
      text: m.text || '',
      time: getTimeAgo(m.timestamp),
      timestamp: m.timestamp,
      risk: m.risk_level?.toLowerCase() || 'medium',
      flagged: Array.isArray(m.content_flags) ? m.content_flags.length > 0 : (m.content_flags && m.content_flags !== '[]'),
      forwarded: m.is_forwarded,
      media: m.has_media
    }));
    
    res.json(messages);
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

// GET /api/health - Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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