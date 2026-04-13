"""
TNAS - FastAPI Backend
Run with: uvicorn api:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import asyncpg
import asyncio
import json
import csv
import io
from datetime import datetime
from fastapi.responses import StreamingResponse

app = FastAPI(
    title="TNAS - Telegram Network Analysis System",
    description="Research tool for mapping harmful content networks on Telegram",
    version="1.0.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # restrict to dashboard origin
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ============================================================
# DB pool (initialized on startup)
# ============================================================
db_pool: asyncpg.Pool = None

@app.on_event("startup")
async def startup():
    global db_pool
    from config import Config
    db_pool = await asyncpg.create_pool(Config.DB_DSN, min_size=2, max_size=10)

@app.on_event("shutdown")
async def shutdown():
    await db_pool.close()


# ============================================================
# Pydantic models
# ============================================================

class IngestRequest(BaseModel):
    seeds: List[str]                   # list of usernames or t.me links
    max_depth: Optional[int] = 2
    messages_per_channel: Optional[int] = 200
    session_notes: Optional[str] = ""

class IngestResponse(BaseModel):
    session_id: str
    status: str
    seeds_queued: int
    message: str

class ChannelRisk(BaseModel):
    username: str
    display_name: Optional[str]
    channel_type: Optional[str]
    score: float
    risk_label: str
    keyword_score: float
    centrality_score: float
    repost_score: float
    link_score: float
    unique_keywords: List[str]
    in_degree: int
    out_degree: int
    first_seen: Optional[datetime]

class GraphEdge(BaseModel):
    source: str
    target: str
    edge_type: str
    weight: int

class GraphResponse(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[GraphEdge]
    node_count: int
    edge_count: int

class InsightsResponse(BaseModel):
    top_hubs: List[Dict]
    most_promoted_bots: List[Dict]
    cluster_summary: List[Dict]
    fastest_spreading: List[Dict]
    total_channels: int
    total_edges: int
    high_risk_count: int


# ============================================================
# ENDPOINT: /ingest
# Accepts seed channels and queues a crawl job
# ============================================================

@app.post("/ingest", response_model=IngestResponse)
async def ingest(request: IngestRequest, background_tasks: BackgroundTasks):
    """
    Queue a new crawl session starting from the provided seed channels.
    The crawl runs as a background task.
    """
    from tnas_core import SeedDiscovery, Config
    import uuid

    config = Config()
    discovery = SeedDiscovery(keywords=[])

    # Extract usernames from input (handles both usernames and full t.me URLs)
    text_blob = " ".join(request.seeds)
    seeds = discovery.extract_from_text(text_blob, source="api_ingest")

    # Also accept bare usernames
    for s in request.seeds:
        if re.match(r"^[a-zA-Z0-9_]{4,32}$", s) and s not in [sd.username for sd in seeds]:
            seeds.append(SeedChannel(username=s, source="api_ingest"))

    seeds = discovery.deduplicate(seeds)

    if not seeds:
        raise HTTPException(status_code=400, detail="No valid Telegram usernames extracted from input")

    session_id = str(uuid.uuid4())

    # Create session record
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO crawl_sessions (id, seed_channels, max_depth, notes)
            VALUES ($1, $2, $3, $4)
        """, session_id, [s.username for s in seeds], request.max_depth, request.session_notes)

        # Queue seeds
        for seed in seeds:
            await conn.execute("""
                INSERT INTO crawl_queue (username, depth, discovery_type, status)
                VALUES ($1, 0, 'seed', 'pending')
                ON CONFLICT (username) DO NOTHING
            """, seed.username)

    # Run crawl in background
    background_tasks.add_task(run_crawl_session, session_id, request.max_depth, request.messages_per_channel)

    return IngestResponse(
        session_id=session_id,
        status="queued",
        seeds_queued=len(seeds),
        message=f"Queued {len(seeds)} seed channels for crawl (depth={request.max_depth})"
    )

@app.get("/ingest/status/{session_id}")
async def ingest_status(session_id: str):
    """Check status of a crawl session."""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, status, channels_found, messages_ingested, edges_created,
                   started_at, ended_at
            FROM crawl_sessions WHERE id = $1
        """, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return dict(row)


# ============================================================
# ENDPOINT: /risk
# Returns risk scores for channels
# ============================================================

@app.get("/risk", response_model=List[ChannelRisk])
async def get_risk(
    min_score: float = Query(0, ge=0, le=100),
    label: Optional[str] = Query(None, description="Filter by risk label: CRITICAL/HIGH/MEDIUM/LOW"),
    limit: int = Query(50, le=500),
    offset: int = 0
):
    """Return channels sorted by risk score."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                c.username, c.display_name, c.channel_type,
                r.score, r.risk_label,
                r.keyword_score, r.centrality_score, r.repost_score, r.link_score,
                r.unique_keywords_matched, r.in_degree, r.out_degree,
                c.first_seen
            FROM risk_scores r
            JOIN channels c ON c.id = r.channel_id
            WHERE r.score >= $1
              AND ($2::text IS NULL OR r.risk_label = $2)
            ORDER BY r.score DESC
            LIMIT $3 OFFSET $4
        """, min_score, label, limit, offset)

    return [
        ChannelRisk(
            username=row["username"],
            display_name=row["display_name"],
            channel_type=row["channel_type"],
            score=row["score"],
            risk_label=row["risk_label"],
            keyword_score=row["keyword_score"],
            centrality_score=row["centrality_score"],
            repost_score=row["repost_score"],
            link_score=row["link_score"],
            unique_keywords=row["unique_keywords_matched"] or [],
            in_degree=row["in_degree"],
            out_degree=row["out_degree"],
            first_seen=row["first_seen"],
        )
        for row in rows
    ]


# ============================================================
# ENDPOINT: /graph
# Returns graph data for visualization
# ============================================================

@app.get("/graph", response_model=GraphResponse)
async def get_graph(
    min_risk: float = Query(0, description="Only include channels with risk >= this"),
    edge_types: Optional[str] = Query(None, description="Comma-separated edge types to include"),
    limit_nodes: int = Query(500, le=2000),
):
    """
    Return graph data in node-link format for frontend visualization.
    Nodes include risk score for coloring. Edges include type and weight.
    """
    async with db_pool.acquire() as conn:
        # Fetch nodes
        node_rows = await conn.fetch("""
            SELECT c.username, c.display_name, c.channel_type,
                   COALESCE(r.score, 0) as score,
                   COALESCE(r.risk_label, 'UNKNOWN') as risk_label,
                   COALESCE(r.pagerank, 0) as pagerank,
                   COALESCE(r.in_degree, 0) as in_degree
            FROM channels c
            LEFT JOIN risk_scores r ON r.channel_id = c.id
            WHERE COALESCE(r.score, 0) >= $1
            ORDER BY COALESCE(r.score, 0) DESC
            LIMIT $2
        """, min_risk, limit_nodes)

        # Fetch edges between those nodes
        usernames = [r["username"] for r in node_rows]
        edge_rows = await conn.fetch("""
            SELECT s.username as source, t.username as target,
                   e.edge_type, e.occurrence_count as weight
            FROM edges e
            JOIN channels s ON s.id = e.source_id
            JOIN channels t ON t.id = e.target_id
            WHERE s.username = ANY($1) AND t.username = ANY($1)
        """, usernames)

    nodes = [
        {
            "id": r["username"],
            "label": r["display_name"] or r["username"],
            "type": r["channel_type"],
            "score": float(r["score"]),
            "risk_label": r["risk_label"],
            "pagerank": float(r["pagerank"]),
            "in_degree": int(r["in_degree"]),
        }
        for r in node_rows
    ]

    edges = [
        GraphEdge(
            source=r["source"],
            target=r["target"],
            edge_type=r["edge_type"],
            weight=r["weight"],
        )
        for r in edge_rows
    ]

    return GraphResponse(
        nodes=nodes,
        edges=edges,
        node_count=len(nodes),
        edge_count=len(edges),
    )


# ============================================================
# ENDPOINT: /insights
# ============================================================

@app.get("/insights", response_model=InsightsResponse)
async def get_insights():
    """Return high-level network insights for the analyst dashboard."""
    async with db_pool.acquire() as conn:
        total_channels = await conn.fetchval("SELECT COUNT(*) FROM channels")
        total_edges = await conn.fetchval("SELECT COUNT(*) FROM edges")
        high_risk = await conn.fetchval(
            "SELECT COUNT(*) FROM risk_scores WHERE risk_label IN ('CRITICAL', 'HIGH')"
        )

        top_hubs = await conn.fetch("""
            SELECT c.username, r.pagerank, r.in_degree, r.score
            FROM risk_scores r JOIN channels c ON c.id = r.channel_id
            ORDER BY r.pagerank DESC LIMIT 10
        """)

        bots = await conn.fetch("""
            SELECT c.username, r.in_degree, r.score
            FROM risk_scores r
            JOIN channels c ON c.id = r.channel_id
            WHERE c.channel_type = 'bot'
            ORDER BY r.in_degree DESC LIMIT 10
        """)

        # Clusters: count channels per community (stored in node attrs)
        spreading = await conn.fetch("""
            SELECT c.username, SUM(m.forward_count) as total_forwards
            FROM messages m JOIN channels c ON c.id = m.channel_id
            GROUP BY c.username
            ORDER BY total_forwards DESC LIMIT 10
        """)

    return InsightsResponse(
        top_hubs=[dict(r) for r in top_hubs],
        most_promoted_bots=[dict(r) for r in bots],
        cluster_summary=[],  # populated by separate /insights/clusters endpoint
        fastest_spreading=[dict(r) for r in spreading],
        total_channels=total_channels,
        total_edges=total_edges,
        high_risk_count=high_risk,
    )


# ============================================================
# ENDPOINT: /export
# CSV and JSON export for journalists
# ============================================================

@app.get("/export/csv")
async def export_csv(min_score: float = 0):
    """Export high-risk channels as CSV for analyst use."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT c.username, c.display_name, c.channel_type, c.subscriber_count,
                   r.score, r.risk_label, r.keyword_score, r.link_score,
                   r.centrality_score, r.repost_score,
                   r.in_degree, r.out_degree, r.bot_link_count,
                   r.unique_keywords_matched, c.first_seen
            FROM v_high_risk_channels r
            JOIN channels c ON c.username = r.username
            WHERE r.score >= $1
            ORDER BY r.score DESC
        """, min_score)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "username", "display_name", "type", "subscribers",
        "risk_score", "risk_label", "keyword_score", "link_score",
        "centrality_score", "repost_score", "in_degree", "out_degree",
        "bot_links", "keywords_matched", "first_seen"
    ])
    for row in rows:
        writer.writerow([
            row["username"], row["display_name"], row["channel_type"],
            row["subscriber_count"], row["score"], row["risk_label"],
            row["keyword_score"], row["link_score"],
            row["centrality_score"], row["repost_score"],
            row["in_degree"], row["out_degree"], row["bot_link_count"],
            ", ".join(row["unique_keywords_matched"] or []),
            row["first_seen"].isoformat() if row["first_seen"] else ""
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=tnas_export.csv"}
    )

@app.get("/export/json")
async def export_json(min_score: float = 0):
    """Export risk data as JSON."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM v_high_risk_channels WHERE score >= $1 ORDER BY score DESC
        """, min_score)

    data = [dict(r) for r in rows]
    for d in data:
        if "first_seen" in d and d["first_seen"]:
            d["first_seen"] = d["first_seen"].isoformat()

    return StreamingResponse(
        iter([json.dumps(data, indent=2)]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=tnas_export.json"}
    )


# ============================================================
# Background crawl worker
# ============================================================
import re
from tnas_core import SeedChannel

async def run_crawl_session(session_id: str, max_depth: int, msg_limit: int):
    """
    Background task: process crawl queue until empty or max_depth reached.
    This is the snowball expansion loop.
    """
    from tnas_core import TelegramIngester, GraphBuilder, RiskScorer, Config
    import uuid

    config = Config()
    ingester = TelegramIngester(config)
    await ingester.connect()

    # Load keywords from DB
    async with db_pool.acquire() as conn:
        kw_rows = await conn.fetch("SELECT term, weight FROM keywords WHERE is_active = TRUE")
        ingester.keywords = [r["term"] for r in kw_rows]
        kw_weights = {r["term"]: float(r["weight"]) for r in kw_rows}

    channels_found = 0
    messages_ingested = 0
    edges_created = 0

    try:
        while True:
            # Fetch next item from queue
            async with db_pool.acquire() as conn:
                item = await conn.fetchrow("""
                    UPDATE crawl_queue SET status = 'processing', attempts = attempts + 1
                    WHERE id = (
                        SELECT id FROM crawl_queue
                        WHERE status = 'pending' AND depth <= $1
                        ORDER BY priority ASC, queued_at ASC
                        LIMIT 1 FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, username, depth
                """, max_depth)

            if not item:
                break  # queue exhausted

            username = item["username"]
            depth = item["depth"]

            # Fetch channel metadata
            meta = await ingester.fetch_channel_metadata(username)
            if not meta:
                async with db_pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE crawl_queue SET status = 'failed' WHERE id = $1", item["id"]
                    )
                continue

            # Store channel in DB
            async with db_pool.acquire() as conn:
                channel_id = await conn.fetchval("""
                    INSERT INTO channels (
                        telegram_id, username, display_name, description,
                        subscriber_count, is_verified, is_scam, channel_type,
                        crawl_depth, last_crawled
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                    ON CONFLICT (username) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        subscriber_count = EXCLUDED.subscriber_count,
                        last_crawled = NOW()
                    RETURNING id
                """,
                    meta["telegram_id"], meta["username"], meta["display_name"],
                    meta["description"], meta["subscriber_count"],
                    meta["is_verified"], meta["is_scam"], meta["channel_type"],
                    depth
                )
            channels_found += 1

            # Fetch messages
            messages = await ingester.fetch_messages(username, limit=msg_limit)

            # Store messages and extract edges
            async with db_pool.acquire() as conn:
                for msg in messages:
                    msg_id = await conn.fetchval("""
                        INSERT INTO messages (
                            telegram_msg_id, channel_id, message_date,
                            has_media, media_type, view_count, forward_count,
                            extracted_links, extracted_mentions, keyword_flags,
                            keyword_match_count, is_forwarded
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                        ON CONFLICT (channel_id, telegram_msg_id) DO NOTHING
                        RETURNING id
                    """,
                        msg["telegram_msg_id"], channel_id, msg["message_date"],
                        msg["has_media"], msg["media_type"], msg.get("view_count"),
                        msg.get("forward_count"),
                        msg["extracted_links"], msg["extracted_mentions"],
                        msg["keyword_flags"], msg["keyword_match_count"],
                        msg["is_forwarded"]
                    )
                    messages_ingested += 1

                    # Create FORWARDED_FROM edge
                    if msg["is_forwarded"] and msg.get("forwarded_from_tg_id"):
                        fwd_row = await conn.fetchrow(
                            "SELECT id FROM channels WHERE telegram_id = $1",
                            msg["forwarded_from_tg_id"]
                        )
                        if fwd_row:
                            await conn.execute(
                                "SELECT upsert_edge($1, $2, 'FORWARDED_FROM', $3)",
                                channel_id, fwd_row["id"], msg_id
                            )
                            edges_created += 1

                    # Create LINKS_TO edges
                    for link in msg["extracted_links"]:
                        linked_row = await conn.fetchrow(
                            "SELECT id FROM channels WHERE username = $1", link
                        )
                        if linked_row:
                            await conn.execute(
                                "SELECT upsert_edge($1, $2, 'LINKS_TO', $3)",
                                channel_id, linked_row["id"], msg_id
                            )
                            edges_created += 1

            # Discover new candidates for queue (snowball expansion)
            if depth < max_depth:
                new_candidates = ingester.extract_new_candidates(messages)
                async with db_pool.acquire() as conn:
                    for candidate in new_candidates:
                        await conn.execute("""
                            INSERT INTO crawl_queue
                                (username, depth, discovery_type, source_channel, priority)
                            VALUES ($1, $2, 'link', $3, $4)
                            ON CONFLICT (username) DO NOTHING
                        """, candidate, depth + 1, channel_id, depth + 2)

            # Mark done
            async with db_pool.acquire() as conn:
                await conn.execute(
                    "UPDATE crawl_queue SET status = 'done', processed_at = NOW() WHERE id = $1",
                    item["id"]
                )

    finally:
        await ingester.disconnect()
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE crawl_sessions
                SET status = 'complete', ended_at = NOW(),
                    channels_found = $1, messages_ingested = $2, edges_created = $3
                WHERE id = $4
            """, channels_found, messages_ingested, edges_created, session_id)
