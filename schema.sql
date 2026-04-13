-- ============================================================
-- TNAS: Telegram Network Analysis System
-- PostgreSQL Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for keyword search

-- ============================================================
-- CHANNELS
-- Represents any Telegram channel or bot discovered
-- ============================================================
CREATE TABLE channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id     BIGINT UNIQUE,                -- Telegram's internal numeric ID
    username        TEXT UNIQUE,                  -- e.g., "nudifybot123" (no @)
    display_name    TEXT,
    description     TEXT,
    channel_type    TEXT CHECK (channel_type IN ('channel', 'bot', 'group', 'unknown')),
    subscriber_count INTEGER,
    is_verified     BOOLEAN DEFAULT FALSE,
    is_scam         BOOLEAN DEFAULT FALSE,        -- Telegram's own flag
    language_code   TEXT,
    created_at      TIMESTAMPTZ,                  -- channel creation date (if available)
    first_seen      TIMESTAMPTZ DEFAULT NOW(),    -- when WE first discovered it
    last_crawled    TIMESTAMPTZ,
    crawl_depth     INTEGER DEFAULT 0,            -- how many hops from seed
    is_seed         BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    notes           TEXT                          -- analyst annotations
);

CREATE INDEX idx_channels_telegram_id ON channels(telegram_id);
CREATE INDEX idx_channels_username ON channels(username);
CREATE INDEX idx_channels_type ON channels(channel_type);
CREATE INDEX idx_channels_first_seen ON channels(first_seen);

-- Full-text search on channel description
CREATE INDEX idx_channels_description_trgm ON channels USING GIN (description gin_trgm_ops);


-- ============================================================
-- MESSAGES (metadata only — no sensitive content stored)
-- ============================================================
CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_msg_id     BIGINT,
    channel_id          UUID REFERENCES channels(id) ON DELETE CASCADE,
    message_date        TIMESTAMPTZ,
    has_media           BOOLEAN DEFAULT FALSE,
    media_type          TEXT,                     -- 'photo', 'video', 'document', etc.
    view_count          INTEGER,
    forward_count       INTEGER,
    reply_count         INTEGER,
    -- Extracted metadata (not raw text)
    extracted_links     TEXT[],                   -- all t.me links found
    extracted_mentions  TEXT[],                   -- all @username mentions
    keyword_flags       TEXT[],                   -- which risk keywords matched
    keyword_match_count INTEGER DEFAULT 0,
    -- Forward chain info
    forwarded_from_channel_id   UUID REFERENCES channels(id),
    forwarded_from_msg_id       BIGINT,
    is_forwarded        BOOLEAN DEFAULT FALSE,
    ingested_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(channel_id, telegram_msg_id)
);

CREATE INDEX idx_messages_channel_id ON messages(channel_id);
CREATE INDEX idx_messages_date ON messages(message_date);
CREATE INDEX idx_messages_forwarded ON messages(forwarded_from_channel_id) WHERE is_forwarded = TRUE;
CREATE INDEX idx_messages_keyword_count ON messages(keyword_match_count DESC);


-- ============================================================
-- EDGES
-- Directed relationships between channels
-- ============================================================
CREATE TABLE edges (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id       UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    edge_type       TEXT NOT NULL CHECK (edge_type IN (
                        'FORWARDED_FROM',   -- channel A forwarded content from channel B
                        'MENTIONS',         -- channel A mentioned @B in a message
                        'LINKS_TO'          -- channel A posted a t.me/B link
                    )),
    first_seen      TIMESTAMPTZ DEFAULT NOW(),
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    occurrence_count INTEGER DEFAULT 1,      -- how many times this edge was observed
    message_ids     UUID[],                  -- references to messages table
    UNIQUE(source_id, target_id, edge_type)
);

CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type ON edges(edge_type);
CREATE INDEX idx_edges_count ON edges(occurrence_count DESC);

-- Update edge count (call this instead of inserting duplicates)
-- Usage: SELECT upsert_edge(source_uuid, target_uuid, 'FORWARDED_FROM', message_uuid)
CREATE OR REPLACE FUNCTION upsert_edge(
    p_source    UUID,
    p_target    UUID,
    p_type      TEXT,
    p_msg_id    UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO edges (source_id, target_id, edge_type, message_ids)
    VALUES (p_source, p_target, p_type, ARRAY[p_msg_id])
    ON CONFLICT (source_id, target_id, edge_type)
    DO UPDATE SET
        occurrence_count = edges.occurrence_count + 1,
        last_seen = NOW(),
        message_ids = array_append(edges.message_ids, p_msg_id);
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- RISK SCORES
-- ============================================================
CREATE TABLE risk_scores (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id          UUID UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
    score               FLOAT CHECK (score >= 0 AND score <= 100),
    score_normalized    FLOAT CHECK (score_normalized >= 0 AND score_normalized <= 1),
    -- Component scores
    keyword_score       FLOAT DEFAULT 0,   -- 0-25: keyword frequency contribution
    link_score          FLOAT DEFAULT 0,   -- 0-25: outgoing bot/harmful links
    centrality_score    FLOAT DEFAULT 0,   -- 0-25: PageRank / degree centrality
    repost_score        FLOAT DEFAULT 0,   -- 0-25: forward/repost activity
    -- Graph metrics (raw)
    pagerank            FLOAT DEFAULT 0,
    in_degree           INTEGER DEFAULT 0,
    out_degree          INTEGER DEFAULT 0,
    betweenness         FLOAT DEFAULT 0,
    -- Keyword stats
    total_messages_analyzed     INTEGER DEFAULT 0,
    flagged_messages_count      INTEGER DEFAULT 0,
    unique_keywords_matched     TEXT[],
    -- Activity stats
    outgoing_link_count         INTEGER DEFAULT 0,
    bot_link_count              INTEGER DEFAULT 0,
    repost_count                INTEGER DEFAULT 0,
    unique_sources_forwarded    INTEGER DEFAULT 0,
    -- Metadata
    risk_label      TEXT CHECK (risk_label IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
    computed_at     TIMESTAMPTZ DEFAULT NOW(),
    model_version   TEXT DEFAULT 'v1.0'
);

CREATE INDEX idx_risk_scores_score ON risk_scores(score DESC);
CREATE INDEX idx_risk_scores_label ON risk_scores(risk_label);


-- ============================================================
-- CRAWL QUEUE
-- Tracks pending channels to crawl
-- ============================================================
CREATE TABLE crawl_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        TEXT UNIQUE,
    telegram_id     BIGINT,
    priority        INTEGER DEFAULT 5,       -- 1 (highest) to 10 (lowest)
    depth           INTEGER DEFAULT 0,
    source_channel  UUID REFERENCES channels(id),
    discovery_type  TEXT CHECK (discovery_type IN ('seed', 'forward', 'mention', 'link')),
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
    attempts        INTEGER DEFAULT 0,
    error_message   TEXT,
    queued_at       TIMESTAMPTZ DEFAULT NOW(),
    processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_crawl_queue_status ON crawl_queue(status, priority);
CREATE INDEX idx_crawl_queue_depth ON crawl_queue(depth);


-- ============================================================
-- KEYWORD REGISTRY
-- Configurable list of risk keywords
-- ============================================================
CREATE TABLE keywords (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    term        TEXT UNIQUE NOT NULL,
    weight      FLOAT DEFAULT 1.0,           -- multiplier for risk scoring
    category    TEXT,                        -- e.g., 'nudify', 'deepfake', 'explicit'
    is_active   BOOLEAN DEFAULT TRUE,
    added_by    TEXT,
    added_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed keywords
INSERT INTO keywords (term, weight, category) VALUES
    ('nudify', 2.0, 'nudify'),
    ('undress ai', 2.0, 'nudify'),
    ('ai undress', 2.0, 'nudify'),
    ('deepnude', 2.5, 'deepfake'),
    ('deepfake', 1.5, 'deepfake'),
    ('remove clothes ai', 2.0, 'nudify'),
    ('nsfw bot', 1.5, 'explicit'),
    ('nude generator', 2.0, 'nudify'),
    ('clothes remover', 2.0, 'nudify');


-- ============================================================
-- CRAWL SESSIONS
-- Tracks full crawl runs for auditing
-- ============================================================
CREATE TABLE crawl_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    seed_channels   TEXT[],
    max_depth       INTEGER,
    channels_found  INTEGER DEFAULT 0,
    messages_ingested INTEGER DEFAULT 0,
    edges_created   INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed', 'stopped')),
    notes           TEXT
);


-- ============================================================
-- VIEWS (useful for API queries)
-- ============================================================

-- High-risk channels with full context
CREATE VIEW v_high_risk_channels AS
SELECT
    c.username,
    c.display_name,
    c.channel_type,
    c.subscriber_count,
    c.crawl_depth,
    r.score,
    r.risk_label,
    r.keyword_score,
    r.centrality_score,
    r.repost_score,
    r.link_score,
    r.unique_keywords_matched,
    r.pagerank,
    r.in_degree,
    r.out_degree,
    r.flagged_messages_count,
    r.bot_link_count,
    c.first_seen
FROM channels c
JOIN risk_scores r ON r.channel_id = c.id
ORDER BY r.score DESC;

-- Edge list for graph export
CREATE VIEW v_edge_list AS
SELECT
    s.username AS source_username,
    t.username AS target_username,
    e.edge_type,
    e.occurrence_count,
    e.first_seen,
    e.last_seen
FROM edges e
JOIN channels s ON s.id = e.source_id
JOIN channels t ON t.id = e.target_id
ORDER BY e.occurrence_count DESC;
