-- Telegram Harm Tracker - PostgreSQL Schema
-- Run automatically on first container start via docker-entrypoint-initdb.d

CREATE TABLE IF NOT EXISTS channels (
    channel_id          TEXT PRIMARY KEY,
    username            TEXT,
    title               TEXT NOT NULL,
    channel_type        TEXT NOT NULL,
    description         TEXT,
    member_count        INTEGER,
    message_count       INTEGER,
    discovered_at       TIMESTAMPTZ,
    discovery_method    TEXT,
    discovery_keywords  JSONB DEFAULT '[]',
    content_flags       JSONB DEFAULT '[]',
    risk_level          TEXT NOT NULL DEFAULT 'unclassified',
    invite_links        JSONB DEFAULT '[]',
    linked_channels     JSONB DEFAULT '[]',
    first_seen          TIMESTAMPTZ,
    last_seen           TIMESTAMPTZ,
    last_activity       TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_indexed          BOOLEAN NOT NULL DEFAULT FALSE,
    relevance_score     REAL,
    is_dead_end         BOOLEAN NOT NULL DEFAULT FALSE,
    extra_metadata      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_channels_risk_level  ON channels(risk_level);
CREATE INDEX IF NOT EXISTS idx_channels_dead_end    ON channels(is_dead_end, relevance_score);
CREATE INDEX IF NOT EXISTS idx_channels_last_seen   ON channels(last_seen DESC);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
    message_id                  TEXT PRIMARY KEY,
    channel_id                  TEXT NOT NULL REFERENCES channels(channel_id),
    telegram_msg_id             INTEGER NOT NULL,
    text                        TEXT,
    text_hash                   TEXT,
    timestamp                   TIMESTAMPTZ,
    collected_at                TIMESTAMPTZ,
    is_forwarded                BOOLEAN NOT NULL DEFAULT FALSE,
    forward_from_channel_id     TEXT,
    forward_from_msg_id         INTEGER,
    extracted_links             JSONB DEFAULT '[]',
    extracted_mentions          JSONB DEFAULT '[]',
    extracted_hashtags          JSONB DEFAULT '[]',
    has_media                   BOOLEAN NOT NULL DEFAULT FALSE,
    media_type                  TEXT,
    media_hash                  TEXT,
    content_flags               JSONB DEFAULT '[]',
    keyword_matches             JSONB DEFAULT '[]',
    sender_id_hash              TEXT,
    is_processed                BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_messages_channel     ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp   ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_forwarded   ON messages(is_forwarded);
CREATE INDEX IF NOT EXISTS idx_messages_text_fts    ON messages USING gin(to_tsvector('english', coalesce(text, '')));

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS edges (
    edge_id             TEXT PRIMARY KEY,
    source_channel_id   TEXT NOT NULL REFERENCES channels(channel_id),
    target_channel_id   TEXT NOT NULL REFERENCES channels(channel_id),
    edge_type           TEXT NOT NULL,
    weight              INTEGER NOT NULL DEFAULT 1,
    first_seen          TIMESTAMPTZ,
    last_seen           TIMESTAMPTZ,
    sample_message_ids  JSONB DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_channel_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_channel_id);
CREATE INDEX IF NOT EXISTS idx_edges_type   ON edges(edge_type);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS actors (
    actor_id                TEXT PRIMARY KEY,
    channels_active_in      JSONB DEFAULT '[]',
    first_seen              TIMESTAMPTZ,
    last_seen               TIMESTAMPTZ,
    message_count           INTEGER NOT NULL DEFAULT 0,
    posting_frequency       REAL,
    typical_post_times      JSONB DEFAULT '[]',
    content_flags           JSONB DEFAULT '[]',
    cross_channel_posts     INTEGER NOT NULL DEFAULT 0,
    channels_administered   JSONB DEFAULT '[]',
    risk_level              TEXT NOT NULL DEFAULT 'unclassified',
    risk_signals            JSONB DEFAULT '[]'
);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS keywords (
    keyword             TEXT PRIMARY KEY,
    category            TEXT,
    language            TEXT NOT NULL DEFAULT 'en',
    channels_discovered INTEGER NOT NULL DEFAULT 0,
    messages_matched    INTEGER NOT NULL DEFAULT 0,
    precision_estimate  REAL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    added_at            TIMESTAMPTZ,
    source              TEXT NOT NULL DEFAULT 'manual'
);
