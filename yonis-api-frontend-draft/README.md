# Harm Tracker — Frontend + API

Visualization frontend and FastAPI backend for the Harm Tracker Telegram monitoring dataset.

## Stack

- **Backend**: FastAPI (Python) — exposes REST endpoints over the PostgreSQL database
- **Frontend**: Vanilla JS + D3.js — served as static files, talks to the backend API

## Prerequisites

- PostgreSQL must be running and reachable (see `postgres/` for the Docker Compose setup)
- Python dependencies installed: `pip install fastapi uvicorn psycopg2-binary`

## Running

**Backend** — from this directory:

```bash
uvicorn server:app --port 8888
```

Set `DATABASE_URL` if your Postgres instance differs from the default connection string in `server.py`.

**Frontend** — serve the `frontend/` directory over HTTP, e.g.:

```bash
python3 -m http.server 8080 --directory frontend
```

Then open `http://localhost:<frontend-port>` in your browser. The frontend expects the backend to be reachable at `http://localhost:8080` (configured in `frontend/api.js`).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | Aggregate counts and top flags/mentions |
| GET | `/channels` | Paginated channel list with optional `risk_level` / `search` filters |
| GET | `/channels/{id}` | Single channel detail |
| GET | `/channels/{id}/messages` | Paginated messages for a channel |
| GET | `/graph` | Nodes and edges for the network visualization |
