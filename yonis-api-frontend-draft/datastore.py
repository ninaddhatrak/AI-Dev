"""
Data Store — PostgreSQL primary storage
========================================
Replaces the previous hybrid SQLite+JSON storage with a single Postgres
backend.  All channel, message, edge, actor and keyword data is stored
directly in Postgres rows; no JSON files are written.

Connection string is read from the environment variable DATABASE_URL.
Defaults to the local docker-compose instance:
    postgresql://tracker:tracker_pw@localhost:5433/harm_tracker
"""

import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from contextlib import contextmanager
from pathlib import Path

import psycopg2
import psycopg2.extras
from psycopg2.extras import RealDictCursor

from .models import Channel, Message, Actor, NetworkEdge, SeedKeyword, ChannelType, RiskLevel, ContentFlag

DEFAULT_DSN = "postgresql://tracker:tracker_pw@localhost:5434/harm_tracker"


class DataStore:
    """
    PostgreSQL-backed storage for Telegram harm-tracker data.
    Thread-safe via per-call connections from a simple DSN.
    """

    def __init__(self, base_path: str = "./data"):
        # base_path kept for API compatibility but ignored — Postgres is primary.
        self.base_path = Path(base_path)
        self.dsn = os.getenv("DATABASE_URL", DEFAULT_DSN)
        self._init_db()

    # ── Connection helpers ─────────────────────────────────────────────────────

    @contextmanager
    def _conn(self):
        conn = psycopg2.connect(self.dsn)
        conn.autocommit = False
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self):
        """Ensure all tables and indexes exist (idempotent)."""
        schema = Path(__file__).parent.parent.parent / "postgres" / "init.sql"
        with self._conn() as conn:
            with conn.cursor() as cur:
                if schema.exists():
                    cur.execute(schema.read_text())
                else:
                    # Inline fallback — mirrors postgres/init.sql exactly
                    cur.execute("""
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
                        CREATE INDEX IF NOT EXISTS idx_channels_risk_level ON channels(risk_level);
                        CREATE INDEX IF NOT EXISTS idx_channels_dead_end   ON channels(is_dead_end, relevance_score);
                        CREATE INDEX IF NOT EXISTS idx_channels_last_seen  ON channels(last_seen DESC);

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
                        CREATE INDEX IF NOT EXISTS idx_messages_channel   ON messages(channel_id);
                        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
                        CREATE INDEX IF NOT EXISTS idx_messages_forwarded ON messages(is_forwarded);
                        CREATE INDEX IF NOT EXISTS idx_messages_text_fts  ON messages USING gin(to_tsvector('english', coalesce(text, '')));

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
                    """)

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _ch_from_row(row: dict) -> Channel:
        def _dt(v):
            if v is None:
                return datetime.utcnow()
            if isinstance(v, datetime):
                return v.replace(tzinfo=None)
            return datetime.fromisoformat(str(v).replace("Z", ""))

        def _flags(v):
            if not v:
                return []
            items = v if isinstance(v, list) else json.loads(v)
            result = []
            for f in items:
                try:
                    result.append(ContentFlag(f))
                except ValueError:
                    pass
            return result

        return Channel(
            channel_id=row["channel_id"],
            username=row.get("username"),
            title=row.get("title", ""),
            channel_type=ChannelType(row.get("channel_type", "channel")),
            member_count=row.get("member_count"),
            risk_level=RiskLevel(row.get("risk_level", "unclassified")),
            discovered_at=_dt(row.get("discovered_at")),
            last_seen=_dt(row.get("last_seen")),
            is_active=bool(row.get("is_active", True)),
            relevance_score=row.get("relevance_score"),
            is_dead_end=bool(row.get("is_dead_end", False)),
            content_flags=_flags(row.get("content_flags")),
            discovery_keywords=(
                row["discovery_keywords"]
                if isinstance(row.get("discovery_keywords"), list)
                else json.loads(row["discovery_keywords"] or "[]")
            ),
        )

    @staticmethod
    def _msg_from_row(row: dict) -> Message:
        def _dt(v):
            if v is None:
                return datetime.utcnow()
            if isinstance(v, datetime):
                return v.replace(tzinfo=None)
            return datetime.fromisoformat(str(v).replace("Z", ""))

        def _flags(v):
            if not v:
                return []
            items = v if isinstance(v, list) else json.loads(v)
            result = []
            for f in items:
                try:
                    result.append(ContentFlag(f))
                except ValueError:
                    pass
            return result

        def _list(v):
            if not v:
                return []
            return v if isinstance(v, list) else json.loads(v)

        return Message(
            message_id=row["message_id"],
            channel_id=row["channel_id"],
            telegram_msg_id=row["telegram_msg_id"],
            text=row.get("text"),
            text_hash=row.get("text_hash"),
            timestamp=_dt(row.get("timestamp")),
            is_forwarded=bool(row.get("is_forwarded", False)),
            forward_from_channel_id=row.get("forward_from_channel_id"),
            forward_from_msg_id=row.get("forward_from_msg_id"),
            has_media=bool(row.get("has_media", False)),
            media_type=row.get("media_type"),
            sender_id_hash=row.get("sender_id_hash"),
            is_processed=bool(row.get("is_processed", False)),
            content_flags=_flags(row.get("content_flags")),
            keyword_matches=_list(row.get("keyword_matches")),
        )

    # ── Channel operations ─────────────────────────────────────────────────────

    def save_channel(self, channel: Channel) -> str:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO channels
                        (channel_id, username, title, channel_type, member_count,
                         risk_level, discovered_at, last_seen, is_active,
                         relevance_score, is_dead_end, content_flags, discovery_keywords,
                         discovery_method)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (channel_id) DO UPDATE SET
                        username           = EXCLUDED.username,
                        title              = EXCLUDED.title,
                        member_count       = EXCLUDED.member_count,
                        risk_level         = EXCLUDED.risk_level,
                        last_seen          = EXCLUDED.last_seen,
                        is_active          = EXCLUDED.is_active,
                        relevance_score    = EXCLUDED.relevance_score,
                        is_dead_end        = EXCLUDED.is_dead_end,
                        content_flags      = EXCLUDED.content_flags,
                        discovery_keywords = EXCLUDED.discovery_keywords,
                        discovery_method   = EXCLUDED.discovery_method
                """, (
                    channel.channel_id,
                    channel.username,
                    channel.title,
                    channel.channel_type.value,
                    channel.member_count,
                    channel.risk_level.value,
                    channel.discovered_at,
                    channel.last_seen,
                    channel.is_active,
                    channel.relevance_score,
                    channel.is_dead_end,
                    json.dumps([f.value for f in channel.content_flags]),
                    json.dumps(channel.discovery_keywords),
                    channel.discovery_method,
                ))
        return channel.channel_id

    def get_channel(self, channel_id: str) -> Optional[Channel]:
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT * FROM channels WHERE channel_id = %s", (channel_id,))
                row = cur.fetchone()
        return self._ch_from_row(dict(row)) if row else None

    def list_channels(self,
                      risk_level: Optional[str] = None,
                      is_active: Optional[bool] = None,
                      is_dead_end: Optional[bool] = None,
                      limit: int = 100,
                      offset: int = 0) -> List[Channel]:
        conditions, params = ["1=1"], []
        if risk_level:
            conditions.append("risk_level = %s"); params.append(risk_level)
        if is_active is not None:
            conditions.append("is_active = %s"); params.append(is_active)
        if is_dead_end is not None:
            conditions.append("is_dead_end = %s"); params.append(is_dead_end)
        params += [limit, offset]
        sql = f"SELECT * FROM channels WHERE {' AND '.join(conditions)} ORDER BY last_seen DESC LIMIT %s OFFSET %s"
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        return [self._ch_from_row(dict(r)) for r in rows]

    def count_channels(self, risk_level: Optional[str] = None) -> int:
        with self._conn() as conn:
            with conn.cursor() as cur:
                if risk_level:
                    cur.execute("SELECT COUNT(*) FROM channels WHERE risk_level = %s", (risk_level,))
                else:
                    cur.execute("SELECT COUNT(*) FROM channels")
                return cur.fetchone()[0]

    def list_channels_by_relevance(self, min_score: float = 0.0, limit: int = 100) -> List[Channel]:
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM channels
                    WHERE is_dead_end = FALSE AND relevance_score IS NOT NULL
                      AND relevance_score >= %s
                    ORDER BY relevance_score DESC LIMIT %s
                """, (min_score, limit))
                rows = cur.fetchall()
        return [self._ch_from_row(dict(r)) for r in rows]

    # ── Message operations ─────────────────────────────────────────────────────

    def save_message(self, message: Message) -> str:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO messages
                        (message_id, channel_id, telegram_msg_id, text, text_hash,
                         timestamp, is_forwarded, forward_from_channel_id,
                         forward_from_msg_id, has_media, media_type,
                         sender_id_hash, is_processed, content_flags, keyword_matches)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (message_id) DO NOTHING
                """, (
                    message.message_id,
                    message.channel_id,
                    message.telegram_msg_id,
                    message.text,
                    message.text_hash,
                    message.timestamp,
                    message.is_forwarded,
                    message.forward_from_channel_id,
                    message.forward_from_msg_id,
                    message.has_media,
                    message.media_type,
                    message.sender_id_hash,
                    message.is_processed,
                    json.dumps([f.value for f in message.content_flags]),
                    json.dumps(message.keyword_matches),
                ))
        return message.message_id

    def save_messages_batch(self, messages: List[Message]) -> int:
        if not messages:
            return 0
        with self._conn() as conn:
            with conn.cursor() as cur:
                rows = [(
                    m.message_id, m.channel_id, m.telegram_msg_id, m.text, m.text_hash,
                    m.timestamp, m.is_forwarded, m.forward_from_channel_id,
                    m.forward_from_msg_id, m.has_media, m.media_type,
                    m.sender_id_hash, m.is_processed,
                    json.dumps([f.value for f in m.content_flags]),
                    json.dumps(m.keyword_matches),
                ) for m in messages]
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO messages
                        (message_id, channel_id, telegram_msg_id, text, text_hash,
                         timestamp, is_forwarded, forward_from_channel_id,
                         forward_from_msg_id, has_media, media_type,
                         sender_id_hash, is_processed, content_flags, keyword_matches)
                    VALUES %s ON CONFLICT (message_id) DO NOTHING
                """, rows)
                return cur.rowcount

    def get_messages_by_channel(self,
                                channel_id: str,
                                start_date: Optional[datetime] = None,
                                end_date: Optional[datetime] = None,
                                limit: int = 100) -> List[Message]:
        conditions, params = ["channel_id = %s"], [channel_id]
        if start_date:
            conditions.append("timestamp >= %s"); params.append(start_date)
        if end_date:
            conditions.append("timestamp <= %s"); params.append(end_date)
        params.append(limit)
        sql = f"SELECT * FROM messages WHERE {' AND '.join(conditions)} ORDER BY timestamp DESC LIMIT %s"
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        return [self._msg_from_row(dict(r)) for r in rows]

    def search_messages(self, query: str, limit: int = 100) -> List[Message]:
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM messages
                    WHERE to_tsvector('english', coalesce(text,'')) @@ plainto_tsquery('english', %s)
                    ORDER BY timestamp DESC LIMIT %s
                """, (query, limit))
                rows = cur.fetchall()
        return [self._msg_from_row(dict(r)) for r in rows]

    def get_forwarded_messages(self, source_channel_id: Optional[str] = None, limit: int = 100) -> List[Message]:
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if source_channel_id:
                    cur.execute("""
                        SELECT * FROM messages WHERE is_forwarded = TRUE
                          AND forward_from_channel_id = %s ORDER BY timestamp DESC LIMIT %s
                    """, (source_channel_id, limit))
                else:
                    cur.execute("""
                        SELECT * FROM messages WHERE is_forwarded = TRUE
                        ORDER BY timestamp DESC LIMIT %s
                    """, (limit,))
                rows = cur.fetchall()
        return [self._msg_from_row(dict(r)) for r in rows]

    # ── Edge operations ────────────────────────────────────────────────────────

    def save_edge(self, edge: NetworkEdge) -> str:
        with self._conn() as conn:
            with conn.cursor() as cur:
                # Skip edges where either endpoint isn't a known channel
                cur.execute(
                    "SELECT COUNT(*) FROM channels WHERE channel_id = ANY(%s)",
                    ([edge.source_channel_id, edge.target_channel_id],)
                )
                if cur.fetchone()[0] < 2:
                    return edge.edge_id
                cur.execute("""
                    INSERT INTO edges
                        (edge_id, source_channel_id, target_channel_id, edge_type,
                         weight, first_seen, last_seen)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (edge_id) DO UPDATE SET
                        weight   = edges.weight + 1,
                        last_seen = EXCLUDED.last_seen
                """, (
                    edge.edge_id,
                    edge.source_channel_id,
                    edge.target_channel_id,
                    edge.edge_type,
                    edge.weight,
                    edge.first_seen,
                    edge.last_seen,
                ))
        return edge.edge_id

    def get_edges_for_channel(self, channel_id: str, direction: str = "both") -> List[Dict]:
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if direction == "outgoing":
                    cur.execute("SELECT * FROM edges WHERE source_channel_id = %s ORDER BY weight DESC", (channel_id,))
                elif direction == "incoming":
                    cur.execute("SELECT * FROM edges WHERE target_channel_id = %s ORDER BY weight DESC", (channel_id,))
                else:
                    cur.execute("SELECT * FROM edges WHERE source_channel_id = %s OR target_channel_id = %s ORDER BY weight DESC", (channel_id, channel_id))
                return [dict(r) for r in cur.fetchall()]

    def get_all_edges(self, edge_type: Optional[str] = None) -> List[Dict]:
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if edge_type:
                    cur.execute("SELECT * FROM edges WHERE edge_type = %s ORDER BY weight DESC", (edge_type,))
                else:
                    cur.execute("SELECT * FROM edges ORDER BY weight DESC")
                return [dict(r) for r in cur.fetchall()]

    # ── Keyword operations ─────────────────────────────────────────────────────

    def save_keyword(self, keyword: SeedKeyword):
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO keywords (keyword, category, channels_discovered, messages_matched, is_active, added_at)
                    VALUES (%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (keyword) DO UPDATE SET
                        channels_discovered = EXCLUDED.channels_discovered,
                        messages_matched    = EXCLUDED.messages_matched,
                        is_active           = EXCLUDED.is_active
                """, (
                    keyword.keyword, keyword.category,
                    keyword.channels_discovered, keyword.messages_matched,
                    keyword.is_active, keyword.added_at,
                ))

    def get_active_keywords(self) -> List[Dict]:
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT * FROM keywords WHERE is_active = TRUE")
                return [dict(r) for r in cur.fetchall()]

    def increment_keyword_stats(self, keyword: str, channels: int = 0, messages: int = 0):
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE keywords SET
                        channels_discovered = channels_discovered + %s,
                        messages_matched    = messages_matched + %s
                    WHERE keyword = %s
                """, (channels, messages, keyword))

    # ── Export / stats ─────────────────────────────────────────────────────────

    def export_to_csv(self, entity_type: str, output_path: Optional[str] = None) -> str:
        import csv
        from pathlib import Path
        out = Path(output_path) if output_path else Path("data/exports") / f"{entity_type}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"SELECT * FROM {entity_type} ORDER BY 1")
                rows = cur.fetchall()
        if rows:
            with open(out, "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=rows[0].keys())
                w.writeheader()
                w.writerows(rows)
        return str(out)

    def export_network_json(self, output_path: Optional[str] = None) -> str:
        out = output_path or f"data/exports/network_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT channel_id, username, title, member_count, risk_level FROM channels")
                nodes = [dict(r) for r in cur.fetchall()]
                cur.execute("SELECT source_channel_id, target_channel_id, edge_type, weight FROM edges")
                edges = [dict(r) for r in cur.fetchall()]
        import json as _json
        with open(out, "w") as f:
            _json.dump({"nodes": nodes, "edges": edges, "exported_at": datetime.utcnow().isoformat()}, f, indent=2)
        return out

    def get_statistics(self) -> Dict[str, Any]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                def scalar(sql, params=()):
                    cur.execute(sql, params); return cur.fetchone()[0]
                return {
                    "total_channels":    scalar("SELECT COUNT(*) FROM channels"),
                    "high_risk_channels": scalar("SELECT COUNT(*) FROM channels WHERE risk_level='high'"),
                    "total_messages":    scalar("SELECT COUNT(*) FROM messages"),
                    "forwarded_messages": scalar("SELECT COUNT(*) FROM messages WHERE is_forwarded"),
                    "total_edges":       scalar("SELECT COUNT(*) FROM edges"),
                    "active_keywords":   scalar("SELECT COUNT(*) FROM keywords WHERE is_active"),
                }
