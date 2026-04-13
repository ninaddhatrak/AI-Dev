# Telegram Network Analysis System (TNAS)
## Architecture & Implementation Guide

---

## 1. SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TNAS - SYSTEM OVERVIEW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐      │
│  │  SEED DISCOVERY  │───▶│ TELEGRAM INGEST  │───▶│ GRAPH BUILDER    │      │
│  │                  │    │                  │    │                  │      │
│  │ - Keyword input  │    │ - Telethon client│    │ - NetworkX       │      │
│  │ - t.me extractor │    │ - Rate limiter   │    │ - Node/edge ops  │      │
│  │ - OSINT dataset  │    │ - Metadata fetch │    │ - Community det. │      │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘      │
│           │                       │                       │                │
│           ▼                       ▼                       ▼                │
│  ┌──────────────────────────────────────────────────────────────┐          │
│  │                     POSTGRESQL DATABASE                       │          │
│  │   channels | messages | edges | risk_scores | crawl_queue    │          │
│  └──────────────────────────────────────────────────────────────┘          │
│                               │                                            │
│           ┌───────────────────┼───────────────────┐                        │
│           ▼                   ▼                   ▼                        │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │  RISK SCORING   │ │ INSIGHTS ENGINE │ │ EXPORT MODULE   │              │
│  │                 │ │                 │ │                 │              │
│  │ - Keyword freq  │ │ - Hub detection │ │ - CSV export    │              │
│  │ - Graph metrics │ │ - Cluster anal. │ │ - JSON export   │              │
│  │ - Repost count  │ │ - Spread paths  │ │ - PDF reports   │              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘              │
│                               │                                            │
│                               ▼                                            │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │                     FASTAPI BACKEND                          │           │
│  │  /ingest  /graph  /risk  /insights  /export  /status        │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                               │                                            │
│                               ▼                                            │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │               REACT DASHBOARD (Frontend)                     │           │
│  │   Network Graph | Risk Table | Timeline | Insights Panel     │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. DATA FLOW (End-to-End)

```
[Analyst inputs keywords]
        │
        ▼
[Seed Discovery] ──── extracts t.me links ────▶ [seed_channels list]
        │
        ▼
[Telegram Ingestion] ── fetches metadata + messages ──▶ [DB: channels, messages]
        │
        ├── extracts forwarded_from ──▶ [new channel candidates]
        ├── extracts @mentions ──────▶ [new channel candidates]
        └── extracts t.me links ─────▶ [new channel candidates]
                    │
                    ▼ (snowball expansion, depth-limited)
            [crawl_queue] ──▶ [Telegram Ingestion] (loop)
                    │
                    ▼
           [Graph Construction] ──▶ [DB: edges, graph snapshot]
                    │
                    ▼
           [Risk Scoring] ──────▶ [DB: risk_scores]
                    │
                    ▼
           [Insights Engine] ─────▶ [API responses]
                    │
                    ▼
           [Dashboard / Export] ──▶ [Journalist-facing outputs]
```

---

## 3. IMPLEMENTATION PLAN

### Phase 1 – Infrastructure (Day 1–2)
- [ ] Provision PostgreSQL DB, run migrations
- [ ] Set up Python virtual environment
- [ ] Configure Telethon credentials (single controlled account)
- [ ] Initialize FastAPI skeleton

### Phase 2 – Core Ingestion (Day 3–5)
- [ ] Implement `SeedDiscovery` module
- [ ] Implement `TelegramIngester` with rate limiting
- [ ] Implement graph extraction (forwards/mentions/links)
- [ ] Store all data to DB

### Phase 3 – Graph & Scoring (Day 6–8)
- [ ] Build NetworkX graph from DB edges
- [ ] Implement PageRank + degree centrality
- [ ] Implement `RiskScorer` class
- [ ] Persist risk scores to DB

### Phase 4 – API & Frontend (Day 9–12)
- [ ] Complete FastAPI endpoints
- [ ] Build React dashboard
- [ ] Wire up graph visualization (Cytoscape.js or Sigma.js)
- [ ] Timeline and insights panels

### Phase 5 – Hardening (Day 13–14)
- [ ] Add rate limit guards and circuit breakers
- [ ] Privacy audit (no PII logging)
- [ ] Export modules (CSV/JSON)
- [ ] Documentation

---

## 4. ETHICS & SAFETY

### What this system DOES:
- Analyzes PUBLIC channel metadata only
- Uses only official Telegram API (no scraping)
- Tracks network structure (who links to whom)
- Operates with a single, transparent research account

### What this system DOES NOT DO:
- Access private groups or DMs
- Download, store, or process actual harmful images/content
- Scrape user profiles or identify individual users
- Bypass any platform restriction or rate limit

### Privacy safeguards:
- Messages are analyzed for metadata only (forward chains, links)
- Message text is keyword-matched, not stored in full
- No user IDs are tracked or retained
- All data is access-controlled within the research organization

### Platform compliance:
- Respects Telethon/MTProto rate limits with exponential backoff
- Uses official API only (not Telegram's internal web client)
- Complies with Telegram's Terms of Service for research use
- Cannot access restricted or age-gated content without explicit channel join

### Limitations:
- Private groups/channels are inaccessible by design
- Deleted messages cannot be retrieved
- Bots that require interaction cannot be analyzed passively
- Channel membership required to read some channels

---

## 5. SCALING IMPROVEMENTS

- **Redis Queue**: Replace in-memory crawl queue with Redis + Celery for distributed crawling
- **Multiple accounts**: Use a pool of research accounts with coordinated rate limiting
- **Neo4j**: Migrate from PostgreSQL edges table to Neo4j for native graph queries
- **Streaming**: Use Telegram's event streaming (via Telethon) for real-time monitoring
- **NLP pipeline**: Add entity extraction (spaCy) to detect new keyword variations automatically

---

## 6. JOURNALIST USE CASES

1. **Hub identification**: "Which 5 channels are distributing this service most widely?"
2. **Origin tracing**: "What's the earliest channel in this forwarding chain?"
3. **Spread velocity**: "How quickly did this bot link propagate over 72 hours?"
4. **Cluster reporting**: "What communities of channels promote this together?"
5. **Risk ranking**: "Which channels should be prioritized for takedown requests?"

---

## 7. EVALUATION METRICS

- **Coverage**: # unique channels discovered per seed / per crawl depth
- **Precision**: % of flagged channels confirmed harmful by manual review
- **Recall**: % of known harmful channels detected (benchmark against known list)
- **Graph completeness**: Edge discovery rate vs. manual sampling
- **Latency**: Time from new channel appearance to detection
```
