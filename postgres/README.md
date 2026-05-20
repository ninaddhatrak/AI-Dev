# Lumen Dashboard

Investigative dashboard for tracking harmful Telegram channels, connected to a PostgreSQL database via a REST API.

## Architecture

```
┌─────────────────────────┐     ┌─────────────────────────┐     ┌──────────────────┐
│  lumen-dashboard │ ──▶ │   Express API (Node.js) │ ──▶ │  PostgreSQL DB   │
│        (HTML/JS)         │     │      server.js:3000    │     │  harm_tracker   │
└─────────────────────────┘     └─────────────────────────┘     └──────────────────┘
```

## Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 16 (or use included docker-compose)

## Quick Start

### 1. Start PostgreSQL

```bash
docker start harm-tracker-postgres
```

Or via docker-compose:
```bash
docker-compose up postgres
```

### 2. Start the API Server

```bash
# Install dependencies
npm install

# Run the server
node server.js
```

The API will start on `http://localhost:3000`.

### 3. Open the Dashboard

Open `lumen-dashboard.html` in a web browser. The dashboard will automatically fetch data from the API.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Aggregate statistics |
| GET | `/api/channels` | List all channels (supports `?risk=high&search=query`) |
| GET | `/api/keywords` | Keyword frequency data |
| GET | `/api/network` | Complete graph nodes + mention/forward edges from live PostgreSQL data |
| GET | `/api/timeline` | Key events timeline |
| GET | `/api/health` | Health check |

### Example Responses

**GET /api/stats**
```json
{
  "totalChannels": 1539,
  "criticalRisk": 21,
  "totalSubscribers": 0,
  "activeChannels": 1539,
  "totalKeywords": 0
}
```

**GET /api/channels**
```json
[
  {
    "name": "@channel_username",
    "category": "channel",
    "subs": 0,
    "created": "Apr 2026",
    "lastActive": "Unknown",
    "risk": "medium",
    "status": "Active"
  }
]
```

## Docker Deployment

### Build and run all services

```bash
docker-compose up --build
```

This starts:
- **PostgreSQL** on port `5433` (internal: `5432`)
- **API** on port `3000`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5433` | PostgreSQL port |
| `DB_NAME` | `harm_tracker` | Database name |
| `DB_USER` | `tracker` | Database user |
| `DB_PASSWORD` | `tracker_pw` | Database password |
| `PORT` | `3000` | API server port |

## Database Schema

### channels
| Column | Type | Description |
|--------|------|-------------|
| channel_id | TEXT | Primary key |
| username | TEXT | Telegram username |
| title | TEXT | Channel title |
| channel_type | TEXT | Type category |
| member_count | INTEGER | Subscriber count |
| risk_level | TEXT | `critical`, `high`, `medium`, `low`, `unclassified` |
| is_active | BOOLEAN | Active status |
| discovered_at | TIMESTAMPTZ | Discovery date |

### edges
| Column | Type | Description |
|--------|------|-------------|
| edge_id | TEXT | Primary key |
| source_channel_id | TEXT | Source channel |
| target_channel_id | TEXT | Target channel |
| edge_type | TEXT | Connection type |
| weight | INTEGER | Edge weight |

### keywords
| Column | Type | Description |
|--------|------|-------------|
| keyword | TEXT | Primary key |
| channels_discovered | INTEGER | Count of channels |
| messages_matched | INTEGER | Count of messages |
| is_active | BOOLEAN | Active status |

## Development

### Project Structure

```
TGBot/
├── package.json          # Node.js dependencies
├── server.js             # Express API server
├── Dockerfile            # API container image
├── docker-compose.yml    # Docker orchestration
├── init.sql              # Database schema
├── lumen-dashboard.html  # Dashboard UI
└── pgdata/               # PostgreSQL data volume
```

### Adding New API Endpoints

1. Edit `server.js`
2. Add new route before the `app.listen()` call:
```javascript
app.get('/api/your-endpoint', async (req, res) => {
  try {
    const result = await pool.query('SELECT ...');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

## Troubleshooting

### Database connection fails
```bash
# Check if PostgreSQL is running
docker ps

# Restart PostgreSQL
docker restart harm-tracker-postgres
```

### API returns empty data
```bash
# Verify data exists in database
docker exec harm-tracker-postgres psql -U tracker -d harm_tracker -c "SELECT COUNT(*) FROM channels;"
```

### Port already in use
```bash
# Kill process on port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

## License

For educational and research purposes only.