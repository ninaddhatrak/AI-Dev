"""
Harm Tracker — FastAPI backend
Connects to the Postgres container and exposes data for the frontend.

    DATABASE_URL defaults to: postgresql://tracker:tracker_pw@localhost:5433/harm_tracker
    Run: uvicorn api.server:app --reload --port 8000
"""

import json
import os
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor

DSN = os.getenv("DATABASE_URL", "postgresql://tracker:tracker_pw@localhost:5433/harm_tracker")

app = FastAPI(title="Harm Tracker API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@contextmanager
def conn():
    c = psycopg2.connect(DSN)
    try:
        yield c
    finally:
        c.close()


def _serialize(obj):
    """Make psycopg2 RealDictRow JSON-serializable."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, (list, dict)):
        return obj
    return str(obj)


def rows_to_json(rows):
    result = []
    for row in rows:
        d = {}
        for k, v in dict(row).items():
            if isinstance(v, datetime):
                d[k] = v.isoformat()
            elif isinstance(v, memoryview):
                d[k] = v.tobytes().decode()
            else:
                d[k] = v
        result.append(d)
    return result


# ── /stats ──────────────────────────────────────────────────────────────────

@app.get("/stats")
def get_stats():
    with conn() as c:
        with c.cursor() as cur:
            def scalar(sql, params=()):
                cur.execute(sql, params)
                return cur.fetchone()[0]

            risk_breakdown = {}
            for level in ("high", "medium", "low", "unclassified"):
                risk_breakdown[level] = scalar(
                    "SELECT COUNT(*) FROM channels WHERE risk_level = %s", (level,)
                )

            cur.execute("""
                SELECT flag, COUNT(*) as cnt
                FROM channels, jsonb_array_elements_text(content_flags) AS flag
                GROUP BY flag ORDER BY cnt DESC
            """)
            flag_rows = cur.fetchall()
            top_flags = [{"flag": r[0], "count": r[1]} for r in flag_rows]

            cur.execute("""
                SELECT mention, COUNT(*) as cnt
                FROM messages, jsonb_array_elements_text(extracted_mentions) AS mention
                GROUP BY mention ORDER BY cnt DESC LIMIT 10
            """)
            mention_rows = cur.fetchall()
            top_mentions = [{"mention": r[0], "count": r[1]} for r in mention_rows]

            return {
                "total_channels": scalar("SELECT COUNT(*) FROM channels"),
                "total_messages": scalar("SELECT COUNT(*) FROM messages"),
                "total_edges": scalar("SELECT COUNT(*) FROM edges"),
                "forwarded_messages": scalar("SELECT COUNT(*) FROM messages WHERE is_forwarded"),
                "active_channels": scalar("SELECT COUNT(*) FROM channels WHERE is_active AND NOT is_dead_end"),
                "risk_breakdown": risk_breakdown,
                "top_flags": top_flags,
                "top_mentions": top_mentions,
            }


# ── /channels ────────────────────────────────────────────────────────────────

@app.get("/channels")
def list_channels(
    risk_level: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(default=200, le=500),
    offset: int = 0,
):
    conditions = ["1=1"]
    params = []

    if risk_level and risk_level != "all":
        conditions.append("risk_level = %s")
        params.append(risk_level)

    if search:
        conditions.append("(lower(title) LIKE %s OR lower(username) LIKE %s)")
        like = f"%{search.lower()}%"
        params.extend([like, like])

    params.extend([limit, offset])
    sql = f"""
        SELECT channel_id, username, title, member_count, risk_level,
               relevance_score, content_flags, is_active, is_dead_end,
               last_seen, discovery_keywords
        FROM channels
        WHERE {' AND '.join(conditions)}
        ORDER BY
            CASE risk_level
                WHEN 'high'         THEN 1
                WHEN 'medium'       THEN 2
                WHEN 'low'          THEN 3
                WHEN 'unclassified' THEN 4
            END,
            relevance_score DESC NULLS LAST
        LIMIT %s OFFSET %s
    """
    with conn() as c:
        with c.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = rows_to_json(cur.fetchall())

    total_sql = f"SELECT COUNT(*) FROM channels WHERE {' AND '.join(conditions[:-0] if not search else conditions)}"
    # simpler total count
    with conn() as c:
        with c.cursor() as cur:
            count_conditions = ["1=1"]
            count_params = []
            if risk_level and risk_level != "all":
                count_conditions.append("risk_level = %s")
                count_params.append(risk_level)
            if search:
                count_conditions.append("(lower(title) LIKE %s OR lower(username) LIKE %s)")
                like = f"%{search.lower()}%"
                count_params.extend([like, like])
            cur.execute(f"SELECT COUNT(*) FROM channels WHERE {' AND '.join(count_conditions)}", count_params)
            total = cur.fetchone()[0]

    return {"channels": rows, "total": total, "limit": limit, "offset": offset}


# ── /channels/{id} ───────────────────────────────────────────────────────────

@app.get("/channels/{channel_id}")
def get_channel(channel_id: str):
    with conn() as c:
        with c.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM channels WHERE channel_id = %s", (channel_id,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Channel not found")
    return rows_to_json([row])[0]


# ── /channels/{id}/messages ──────────────────────────────────────────────────

@app.get("/channels/{channel_id}/messages")
def get_channel_messages(
    channel_id: str,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
):
    with conn() as c:
        with c.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT message_id, telegram_msg_id, text, timestamp,
                       is_forwarded, forward_from_channel_id,
                       content_flags, keyword_matches,
                       extracted_mentions, extracted_links,
                       has_media, media_type
                FROM messages
                WHERE channel_id = %s
                ORDER BY timestamp DESC
                LIMIT %s OFFSET %s
            """, (channel_id, limit, offset))
            rows = rows_to_json(cur.fetchall())
        with c.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM messages WHERE channel_id = %s", (channel_id,))
            total = cur.fetchone()[0]

    return {"messages": rows, "total": total, "limit": limit, "offset": offset}


# ── /graph ───────────────────────────────────────────────────────────────────

@app.get("/graph")
def get_graph(min_weight: int = 1):
    with conn() as c:
        with c.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT channel_id, username, title, member_count,
                       risk_level, relevance_score, content_flags,
                       discovered_at
                FROM channels
            """)
            nodes = rows_to_json(cur.fetchall())

            # Tag the 20 most recently discovered channels
            cur.execute("""
                SELECT channel_id FROM channels
                ORDER BY discovered_at DESC NULLS LAST
                LIMIT 20
            """)
            recent_ids = {row["channel_id"] for row in cur.fetchall()}
            for n in nodes:
                n["is_recent"] = n["channel_id"] in recent_ids

            # Stored edges (sparse — only what the crawler explicitly saved)
            cur.execute("""
                SELECT source_channel_id, target_channel_id, edge_type, weight
                FROM edges
                WHERE weight >= %s
            """, (min_weight,))
            stored_edges = rows_to_json(cur.fetchall())

            # Derive forward edges from messages:
            # Telegram stores channel IDs with a -100 prefix in forward_from_channel_id
            cur.execute("""
                SELECT
                    src.channel_id   AS source_channel_id,
                    tgt.channel_id   AS target_channel_id,
                    'forward'        AS edge_type,
                    COUNT(*)         AS weight
                FROM messages m
                JOIN channels src ON src.channel_id = m.channel_id
                JOIN channels tgt
                  ON tgt.channel_id = REGEXP_REPLACE(m.forward_from_channel_id, '^-100', '')
                WHERE m.forward_from_channel_id IS NOT NULL
                  AND src.channel_id <> tgt.channel_id
                GROUP BY src.channel_id, tgt.channel_id
                HAVING COUNT(*) >= %s
            """, (min_weight,))
            forward_edges = rows_to_json(cur.fetchall())

            # Derive mention edges from extracted_mentions (@username → channel)
            cur.execute("""
                SELECT
                    src.channel_id  AS source_channel_id,
                    tgt.channel_id  AS target_channel_id,
                    'mention'       AS edge_type,
                    COUNT(*)        AS weight
                FROM messages m
                JOIN channels src ON src.channel_id = m.channel_id,
                     jsonb_array_elements_text(m.extracted_mentions) AS mention
                JOIN channels tgt
                  ON LOWER(tgt.username) = LOWER(TRIM(LEADING '@' FROM mention))
                WHERE jsonb_array_length(m.extracted_mentions) > 0
                  AND src.channel_id <> tgt.channel_id
                GROUP BY src.channel_id, tgt.channel_id
                HAVING COUNT(*) >= %s
            """, (min_weight,))
            mention_edges = rows_to_json(cur.fetchall())

    # Merge: stored edges take priority; derived edges fill the gaps
    seen = {(e["source_channel_id"], e["target_channel_id"]) for e in stored_edges}
    merged_edges = list(stored_edges)
    for e in forward_edges + mention_edges:
        key = (e["source_channel_id"], e["target_channel_id"])
        if key not in seen:
            seen.add(key)
            merged_edges.append(e)

    return {"nodes": nodes, "edges": merged_edges}
