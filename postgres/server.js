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
    const channelResult = await pool.query(`
      SELECT 
        COUNT(*) as total_channels,
        COUNT(*) FILTER (WHERE risk_level = 'high') as critical_risk,
        SUM(COALESCE(member_count, 0)) as total_subscribers,
        COUNT(*) FILTER (WHERE is_active = true) as active_channels
      FROM channels
    `);
    
    const keywordResult = await pool.query(`SELECT COUNT(*) as total_keywords FROM keywords`);
    
    const result = channelResult.rows[0];
    res.json({
      totalChannels: parseInt(result.total_channels) || 0,
      criticalRisk: parseInt(result.critical_risk) || 0,
      totalSubscribers: parseInt(result.total_subscribers) || 0,
      activeChannels: parseInt(result.active_channels) || 0,
      totalKeywords: parseInt(keywordResult.rows[0]?.total_keywords) || 0
    });
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
        channels_discovered + messages_matched as frequency,
        category
      FROM keywords
      WHERE is_active = true
      ORDER BY frequency DESC
      LIMIT 50
    `);

    const maxFreq = Math.max(...result.rows.map(r => r.frequency || 0), 1);
    
    const keywords = result.rows.map(k => ({
      term: k.keyword,
      count: k.frequency || 0,
      pct: maxFreq > 0 ? Math.round((k.frequency / maxFreq) * 100) : 0
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
    // Get top channels as nodes
    const nodesResult = await pool.query(`
      SELECT 
        channel_id,
        username,
        member_count,
        risk_level
      FROM channels
      ORDER BY member_count DESC
      LIMIT 20
    `);

    // Get edges between channels
    const edgesResult = await pool.query(`
      SELECT 
        source_channel_id,
        target_channel_id,
        weight,
        edge_type
      FROM edges
      ORDER BY weight DESC
      LIMIT 50
    `);

    // Transform nodes
    const nodeMap = new Map();
    const nodes = nodesResult.rows.map((n, i) => {
      const node = {
        id: n.channel_id,
        label: n.username || `@${n.channel_id.slice(0, 8)}`,
        size: Math.max(8, Math.min(25, Math.log10(n.member_count || 1) * 5)),
        risk: n.risk_level?.toLowerCase() || 'medium'
      };
      nodeMap.set(n.channel_id, node);
      return node;
    });

    // Transform edges (using channel_id to find node indices)
    const edges = edgesResult.rows.map(e => {
      const sourceIdx = nodesResult.rows.findIndex(n => n.channel_id === e.source_channel_id);
      const targetIdx = nodesResult.rows.findIndex(n => n.channel_id === e.target_channel_id);
      if (sourceIdx >= 0 && targetIdx >= 0) {
        return { source: sourceIdx, target: targetIdx, weight: e.weight };
      }
      return null;
    }).filter(e => e !== null);

    res.json({ nodes, edges });
  } catch (err) {
    console.error('Network error:', err.message);
    res.status(500).json({ error: 'Failed to fetch network data' });
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
  console.log(`🚀 SafeTelegram API running on port ${PORT}`);
});