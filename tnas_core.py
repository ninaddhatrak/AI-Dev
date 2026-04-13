"""
TNAS - Telegram Network Analysis System
Core Python Modules

Requirements:
    pip install telethon asyncpg fastapi uvicorn networkx redis python-dotenv
"""

# ============================================================
# config.py
# ============================================================
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Telegram API (from https://my.telegram.org)
    TG_API_ID       = int(os.getenv("TG_API_ID", "0"))
    TG_API_HASH     = os.getenv("TG_API_HASH", "")
    TG_SESSION_NAME = os.getenv("TG_SESSION_NAME", "tnas_research")

    # Database
    DB_DSN = os.getenv("DATABASE_URL", "postgresql://tnas:password@localhost/tnas")

    # Crawl settings
    MAX_CRAWL_DEPTH     = int(os.getenv("MAX_CRAWL_DEPTH", "3"))
    MESSAGES_PER_CHANNEL = int(os.getenv("MESSAGES_PER_CHANNEL", "200"))
    RATE_LIMIT_DELAY    = float(os.getenv("RATE_LIMIT_DELAY", "1.5"))  # seconds between requests
    MAX_RETRIES         = int(os.getenv("MAX_RETRIES", "3"))

    # Risk scoring weights (must sum to 1.0)
    W_KEYWORD    = 0.35
    W_LINKS      = 0.25
    W_CENTRALITY = 0.25
    W_REPOSTS    = 0.15


# ============================================================
# MODULE 1: seed_discovery.py
# ============================================================
import re
from typing import List, Set
from dataclasses import dataclass

# Matches: t.me/username, t.me/+invite, https://t.me/username
TG_LINK_RE = re.compile(
    r"(?:https?://)?t\.me/(?:\+)?([a-zA-Z0-9_]{4,32})",
    re.IGNORECASE
)

@dataclass
class SeedChannel:
    username: str
    source: str   # where we found it (e.g., "manual", "osint_csv", "text_scan")

class SeedDiscovery:
    """
    Module 1: Discovers initial seed channels from various inputs.
    Does NOT scrape Telegram — operates on pre-collected external data.
    """

    def __init__(self, keywords: List[str]):
        self.keywords = [kw.lower() for kw in keywords]
        self._seen: Set[str] = set()

    def extract_from_text(self, text: str, source: str = "text") -> List[SeedChannel]:
        """Extract all t.me links from a block of text."""
        seeds = []
        for match in TG_LINK_RE.finditer(text):
            username = match.group(1).lower()
            if username not in self._seen and not username.startswith("+"):
                self._seen.add(username)
                seeds.append(SeedChannel(username=username, source=source))
        return seeds

    def extract_from_url_list(self, urls: List[str]) -> List[SeedChannel]:
        """
        Accept a pre-collected list of URLs (e.g., from OSINT datasets,
        search engine exports, or manual collection).
        """
        seeds = []
        for url in urls:
            found = self.extract_from_text(url, source="url_list")
            seeds.extend(found)
        return seeds

    def extract_from_csv(self, filepath: str) -> List[SeedChannel]:
        """
        Load seeds from a CSV file with columns: [url, source, notes]
        Analysts can maintain this file with findings from external research.
        """
        import csv
        seeds = []
        with open(filepath, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                url = row.get("url", "") or row.get("link", "")
                source = row.get("source", "csv_import")
                found = self.extract_from_text(url, source=source)
                seeds.extend(found)
        return seeds

    def validate_username(self, username: str) -> bool:
        """Basic validation — Telegram usernames are 5-32 chars, alphanumeric + underscore."""
        return bool(re.match(r"^[a-zA-Z0-9_]{4,32}$", username))

    def deduplicate(self, seeds: List[SeedChannel]) -> List[SeedChannel]:
        seen = set()
        result = []
        for s in seeds:
            if s.username not in seen:
                seen.add(s.username)
                result.append(s)
        return result


# ============================================================
# MODULE 2: telegram_ingester.py
# ============================================================
import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timezone

logger = logging.getLogger("tnas.ingester")

class RateLimiter:
    """Token bucket rate limiter for Telegram API calls."""
    def __init__(self, min_delay: float = 1.5):
        self.min_delay = min_delay
        self._last_call = 0.0

    async def wait(self):
        elapsed = asyncio.get_event_loop().time() - self._last_call
        if elapsed < self.min_delay:
            await asyncio.sleep(self.min_delay - elapsed)
        self._last_call = asyncio.get_event_loop().time()


class TelegramIngester:
    """
    Module 2: Fetches public channel metadata and message metadata via Telethon.

    IMPORTANT:
    - Only accesses PUBLIC channels
    - Does NOT join private channels
    - Does NOT download media content
    - Respects rate limits strictly
    """

    def __init__(self, config: Config):
        from telethon import TelegramClient
        self.client = TelegramClient(
            config.TG_SESSION_NAME,
            config.TG_API_ID,
            config.TG_API_HASH
        )
        self.limiter = RateLimiter(config.RATE_LIMIT_DELAY)
        self.config = config
        self.keywords: List[str] = []  # loaded from DB

    async def connect(self):
        await self.client.start()
        logger.info("Telegram client connected")

    async def disconnect(self):
        await self.client.disconnect()

    async def fetch_channel_metadata(self, username: str) -> Optional[Dict[str, Any]]:
        """Fetch public metadata for a channel/bot. Returns None if inaccessible."""
        await self.limiter.wait()
        try:
            from telethon.tl.functions.channels import GetFullChannelRequest
            from telethon.errors import (
                ChannelPrivateError, UsernameNotOccupiedError,
                FloodWaitError, UsernameInvalidError
            )

            entity = await self.client.get_entity(username)
            full = await self.client(GetFullChannelRequest(entity))

            return {
                "telegram_id":      entity.id,
                "username":         getattr(entity, "username", username),
                "display_name":     getattr(entity, "title", ""),
                "description":      getattr(full.full_chat, "about", ""),
                "subscriber_count": getattr(full.full_chat, "participants_count", None),
                "is_verified":      getattr(entity, "verified", False),
                "is_scam":          getattr(entity, "scam", False),
                "channel_type":     self._classify_entity(entity),
            }

        except (ChannelPrivateError,):
            logger.info(f"  [SKIP] {username}: private channel — not accessible")
            return None
        except (UsernameNotOccupiedError, UsernameInvalidError):
            logger.info(f"  [SKIP] {username}: username not found")
            return None
        except FloodWaitError as e:
            logger.warning(f"  [FLOOD] Rate limited — waiting {e.seconds}s")
            await asyncio.sleep(e.seconds + 5)
            return None
        except Exception as e:
            logger.error(f"  [ERROR] {username}: {e}")
            return None

    async def fetch_messages(self, username: str, limit: int = 200) -> List[Dict[str, Any]]:
        """
        Fetch recent messages from a public channel.
        Extracts ONLY metadata: links, mentions, forward chains, keyword flags.
        Full message text is NOT stored — only keyword match flags.
        """
        await self.limiter.wait()
        results = []

        try:
            from telethon.errors import FloodWaitError, ChannelPrivateError

            async for message in self.client.iter_messages(username, limit=limit):
                if message is None or not hasattr(message, "id"):
                    continue

                msg_data = self._extract_message_metadata(message)
                results.append(msg_data)

                # Polite delay every 50 messages
                if len(results) % 50 == 0:
                    await asyncio.sleep(0.5)

        except ChannelPrivateError:
            logger.info(f"  [SKIP] {username}: private — skipping messages")
        except FloodWaitError as e:
            logger.warning(f"  [FLOOD] {e.seconds}s wait required")
            await asyncio.sleep(e.seconds + 5)
        except Exception as e:
            logger.error(f"  [ERROR] messages for {username}: {e}")

        return results

    def _extract_message_metadata(self, message) -> Dict[str, Any]:
        """
        Extract structured metadata from a Telethon message object.
        Keyword matching is done here — raw text is NOT persisted.
        """
        import re

        raw_text = message.text or ""

        # Extract t.me links
        links = list(set(TG_LINK_RE.findall(raw_text)))

        # Extract @mentions
        mention_re = re.compile(r"@([a-zA-Z0-9_]{4,32})")
        mentions = list(set(mention_re.findall(raw_text)))

        # Keyword matching (text not stored)
        matched_keywords = [kw for kw in self.keywords if kw in raw_text.lower()]

        # Forward chain
        fwd_chat = None
        fwd_msg_id = None
        if message.fwd_from:
            if hasattr(message.fwd_from, "from_id") and message.fwd_from.from_id:
                fwd_chat = getattr(message.fwd_from.from_id, "channel_id", None)
            fwd_msg_id = getattr(message.fwd_from, "channel_post", None)

        return {
            "telegram_msg_id":          message.id,
            "message_date":             message.date,
            "has_media":                message.media is not None,
            "media_type":               type(message.media).__name__ if message.media else None,
            "view_count":               getattr(message.views, "__int__", lambda: None)() if message.views else None,
            "forward_count":            getattr(message.forwards, "__int__", lambda: None)() if message.forwards else None,
            "extracted_links":          links,
            "extracted_mentions":       mentions,
            "keyword_flags":            matched_keywords,
            "keyword_match_count":      len(matched_keywords),
            "forwarded_from_tg_id":     fwd_chat,
            "forwarded_from_msg_id":    fwd_msg_id,
            "is_forwarded":             message.fwd_from is not None,
        }

    def _classify_entity(self, entity) -> str:
        from telethon.tl.types import Channel, User, Chat
        if isinstance(entity, User) and entity.bot:
            return "bot"
        if isinstance(entity, Channel):
            return "group" if entity.megagroup else "channel"
        return "unknown"

    def extract_new_candidates(self, messages: List[Dict]) -> List[str]:
        """
        Extract new channel candidates from ingested messages.
        This is the snowball expansion mechanism.
        """
        candidates = set()
        for msg in messages:
            candidates.update(msg.get("extracted_links", []))
            candidates.update(msg.get("extracted_mentions", []))
        return list(candidates)


# ============================================================
# MODULE 3: graph_builder.py
# ============================================================
import networkx as nx
from typing import Tuple

class GraphBuilder:
    """
    Module 3: Constructs and analyzes the network graph.
    Uses NetworkX for in-memory analysis; edges are persisted to PostgreSQL.
    """

    def __init__(self):
        self.G = nx.DiGraph()

    def add_channel(self, username: str, **attrs):
        self.G.add_node(username, **attrs)

    def add_edge(self, source: str, target: str, edge_type: str,
                 timestamp: datetime = None, message_id: str = None):
        if self.G.has_edge(source, target):
            self.G[source][target]["weight"] += 1
            self.G[source][target]["last_seen"] = timestamp
        else:
            self.G.add_edge(source, target,
                edge_type=edge_type,
                weight=1,
                first_seen=timestamp,
                last_seen=timestamp,
                edge_types={edge_type}
            )
        # Track multiple edge types on same connection
        if "edge_types" in self.G[source][target]:
            self.G[source][target]["edge_types"].add(edge_type)

    def load_from_db_rows(self, edge_rows: List[Tuple]):
        """
        Load graph from DB edge list.
        edge_rows: [(source_username, target_username, edge_type, count, first_seen), ...]
        """
        for row in edge_rows:
            src, tgt, etype, count, first_seen = row
            self.G.add_node(src)
            self.G.add_node(tgt)
            self.G.add_edge(src, tgt,
                edge_type=etype,
                weight=count,
                first_seen=first_seen
            )

    def compute_metrics(self) -> Dict[str, Dict]:
        """Compute all graph metrics. Returns per-node metric dict."""
        metrics = {}

        if len(self.G) == 0:
            return metrics

        # PageRank (use weight for stronger signals)
        pagerank = nx.pagerank(self.G, weight="weight", alpha=0.85)

        # Degree centrality
        in_deg = dict(self.G.in_degree(weight="weight"))
        out_deg = dict(self.G.out_degree(weight="weight"))

        # Betweenness (expensive on large graphs — sample if >5000 nodes)
        n = len(self.G)
        if n <= 2000:
            betweenness = nx.betweenness_centrality(self.G, weight="weight", normalized=True)
        else:
            # Approximate with k samples
            betweenness = nx.betweenness_centrality(
                self.G, weight="weight", normalized=True, k=min(500, n)
            )

        for node in self.G.nodes():
            metrics[node] = {
                "pagerank":     pagerank.get(node, 0),
                "in_degree":    in_deg.get(node, 0),
                "out_degree":   out_deg.get(node, 0),
                "betweenness":  betweenness.get(node, 0),
            }

        return metrics

    def detect_communities(self) -> Dict[str, int]:
        """Detect communities using Louvain method (undirected projection)."""
        try:
            import community as community_louvain
            undirected = self.G.to_undirected()
            partition = community_louvain.best_partition(undirected)
            return partition
        except ImportError:
            # Fallback: weakly connected components
            communities = {}
            for i, component in enumerate(nx.weakly_connected_components(self.G)):
                for node in component:
                    communities[node] = i
            return communities

    def get_top_hubs(self, n: int = 20) -> List[Tuple[str, float]]:
        """Return top N nodes by PageRank."""
        metrics = self.compute_metrics()
        ranked = sorted(metrics.items(), key=lambda x: x[1]["pagerank"], reverse=True)
        return [(node, data["pagerank"]) for node, data in ranked[:n]]

    def get_shortest_path(self, source: str, target: str) -> Optional[List[str]]:
        """Find how content can travel from source to target."""
        try:
            return nx.shortest_path(self.G, source, target)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None

    def to_json(self) -> Dict:
        """Export graph as node-link JSON (for frontend visualization)."""
        return nx.node_link_data(self.G)


# ============================================================
# MODULE 4: risk_scorer.py
# ============================================================
import math

class RiskScorer:
    """
    Module 4: Computes risk score (0-100) for each channel.

    Score = weighted sum of 4 components:
      - keyword_score  (0-25): how often risk keywords appear
      - link_score     (0-25): how many links point to bots/harmful channels
      - centrality_score (0-25): graph importance (PageRank-based)
      - repost_score   (0-25): how often this channel's content spreads
    """

    def __init__(self, config: Config):
        self.w_keyword    = config.W_KEYWORD
        self.w_links      = config.W_LINKS
        self.w_centrality = config.W_CENTRALITY
        self.w_reposts    = config.W_REPOSTS

    def compute(
        self,
        channel_username: str,
        messages: List[Dict],
        graph_metrics: Dict,
        keyword_weights: Dict[str, float],  # {keyword: weight}
        all_channels_metadata: Dict[str, Dict],
    ) -> Dict:
        """Compute risk score for a single channel."""

        # --- Component 1: Keyword Score (0-25) ---
        total_msgs = len(messages) if messages else 1
        weighted_keyword_hits = 0
        matched_keywords = set()

        for msg in messages:
            for kw in msg.get("keyword_flags", []):
                weight = keyword_weights.get(kw, 1.0)
                weighted_keyword_hits += weight
                matched_keywords.add(kw)

        # Normalize: assume >50 weighted hits = max score
        keyword_raw = min(weighted_keyword_hits / max(total_msgs, 1) * 10, 1.0)
        keyword_score = keyword_raw * 25

        # --- Component 2: Link Score (0-25) ---
        outgoing_links = set()
        bot_links = 0

        for msg in messages:
            for link in msg.get("extracted_links", []):
                outgoing_links.add(link)
                # Check if linked channel is a bot
                linked_meta = all_channels_metadata.get(link, {})
                if linked_meta.get("channel_type") == "bot":
                    bot_links += 1

        link_raw = min((len(outgoing_links) / 20 + bot_links / 10), 1.0)
        link_score = link_raw * 25

        # --- Component 3: Centrality Score (0-25) ---
        metrics = graph_metrics.get(channel_username, {})
        pagerank = metrics.get("pagerank", 0)

        # PageRank values are tiny (1/N) — normalize relative to max in graph
        max_pr = max((v.get("pagerank", 0) for v in graph_metrics.values()), default=1e-9)
        centrality_raw = pagerank / max_pr if max_pr > 0 else 0
        centrality_score = centrality_raw * 25

        # --- Component 4: Repost Score (0-25) ---
        total_reposts = sum(
            (msg.get("forward_count") or 0) for msg in messages
        )
        # How often does content originate HERE and get forwarded?
        # Check in_degree from graph
        in_degree = metrics.get("in_degree", 0)

        repost_raw = min((total_reposts / 500 + in_degree / 50), 1.0)
        repost_score = repost_raw * 25

        # --- Final Score ---
        raw_score = (
            keyword_score * (self.w_keyword / 0.25) +
            link_score    * (self.w_links / 0.25) +
            centrality_score * (self.w_centrality / 0.25) +
            repost_score  * (self.w_reposts / 0.25)
        ) / 4 * 4  # normalize back to 0-100 range

        # Cap and round
        final_score = min(max(round(
            keyword_score + link_score + centrality_score + repost_score, 2
        ), 0), 100)

        return {
            "score":                    final_score,
            "score_normalized":         final_score / 100,
            "keyword_score":            round(keyword_score, 2),
            "link_score":               round(link_score, 2),
            "centrality_score":         round(centrality_score, 2),
            "repost_score":             round(repost_score, 2),
            "risk_label":               self._label(final_score),
            "pagerank":                 pagerank,
            "in_degree":                int(metrics.get("in_degree", 0)),
            "out_degree":               int(metrics.get("out_degree", 0)),
            "betweenness":              float(metrics.get("betweenness", 0)),
            "total_messages_analyzed":  total_msgs,
            "flagged_messages_count":   sum(1 for m in messages if m.get("keyword_match_count", 0) > 0),
            "unique_keywords_matched":  list(matched_keywords),
            "outgoing_link_count":      len(outgoing_links),
            "bot_link_count":           bot_links,
            "repost_count":             total_reposts,
            "unique_sources_forwarded": int(metrics.get("in_degree", 0)),
        }

    def _label(self, score: float) -> str:
        if score >= 75: return "CRITICAL"
        if score >= 50: return "HIGH"
        if score >= 25: return "MEDIUM"
        if score > 0:   return "LOW"
        return "UNKNOWN"


# ============================================================
# MODULE 5: insights.py
# ============================================================
class InsightsEngine:
    """Module 5: Generates analyst-facing insights from graph + risk data."""

    def __init__(self, graph: GraphBuilder):
        self.graph = graph

    def top_hubs(self, n: int = 10) -> List[Dict]:
        return [
            {"username": u, "pagerank": round(pr, 6)}
            for u, pr in self.graph.get_top_hubs(n)
        ]

    def fastest_spreading_content(self, messages_by_channel: Dict[str, List]) -> List[Dict]:
        """Find messages with highest forward counts (content that spread most)."""
        candidates = []
        for channel, msgs in messages_by_channel.items():
            for msg in msgs:
                fwd = msg.get("forward_count") or 0
                if fwd > 0:
                    candidates.append({
                        "channel": channel,
                        "message_id": msg.get("telegram_msg_id"),
                        "date": msg.get("message_date"),
                        "forward_count": fwd,
                        "keyword_flags": msg.get("keyword_flags", []),
                    })
        return sorted(candidates, key=lambda x: x["forward_count"], reverse=True)[:20]

    def most_promoted_bots(self, all_channels_metadata: Dict) -> List[Dict]:
        """Find bots with most incoming links."""
        bot_in_degree = {}
        for node, attrs in all_channels_metadata.items():
            if attrs.get("channel_type") == "bot":
                metrics = self.graph.compute_metrics().get(node, {})
                bot_in_degree[node] = metrics.get("in_degree", 0)
        return [
            {"username": u, "in_degree": d}
            for u, d in sorted(bot_in_degree.items(), key=lambda x: x[1], reverse=True)[:20]
        ]

    def cluster_summary(self) -> List[Dict]:
        """Summarize detected communities."""
        partition = self.graph.detect_communities()
        clusters = {}
        for node, cluster_id in partition.items():
            if cluster_id not in clusters:
                clusters[cluster_id] = []
            clusters[cluster_id].append(node)

        return [
            {
                "cluster_id": cid,
                "size": len(members),
                "members": members[:10],  # show first 10 for brevity
            }
            for cid, members in sorted(clusters.items(), key=lambda x: len(x[1]), reverse=True)
        ]
