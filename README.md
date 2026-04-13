# Telegram Network Analysis System (TNAS)

TNAS is a research tool for mapping harmful content networks on Telegram. It includes a Python backend for crawling and organizing data, and a React-based frontend dashboard for viewing insights, network graphs, and channel risks.

## Project Structure

- `api.py`: FastAPI server that provides endpoints for ingestion, graph representation, risk data, and exporting.
- `tnas_core.py`: Core logic for crawling Telegram (using Telethon), graph building, and network risk scoring.
- `schema.sql`: PostgreSQL database schema for the system.
- `ARCHITECTURE.md` / `RISK_SCORING_INFO.md`: Explains the design decisions, component layouts, and risk scoring methodology.
- `Dashboard.jsx`: The React component containing the interactive Dashboard UI.

---

## 1. Running the Frontend Demo (UI)

If you only want to view the standalone UI demo (mocked data setup), you can easily run it locally using Vite.

1. Generate a new Vite project if you haven't already:
   ```bash
   npm create vite@latest tnas-demo -- --template react
   ```
2. Navigate into the folder and install dependencies:
   ```bash
   cd tnas-demo
   npm install
   ```
3. Copy the `Dashboard.jsx` file over the default `src/App.jsx` in the `tnas-demo` directory.
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open your web browser to `http://localhost:5173/` to view the UI.

---

## 2. Setting Up the Backend Server

To actually use the ingestion engines and real APIs, you'll need to set up the backend.

### Database Setup
The system relies on PostgreSQL. You'll need to run the included schema script to initialize all required tables.
```bash
psql -U your_postgres_user -d your_database -f schema.sql
```

### Python Dependencies
TNAS is built on Python and uses several core modules. Create a virtual environment and install the required packages (like FastAPI, Uvicorn, AsyncPG, and Telethon):

```bash
python -m venv venv
# Windows: venv\Scripts\activate
# Mac/Linux: source venv/bin/activate
pip install fastapi uvicorn asyncpg telethon networkx pydantic
```

*(Make sure to adjust the DB endpoint configuration inside `config.py` - you may need to define `Config.DB_DSN` properly based on your DB setup as expected by `api.py`)*.

### Running FastAPI

Start the API server by running Uvicorn:

```bash
uvicorn api:app --reload --port 8000
```

Once running, the backend will be available at `http://localhost:8000`.
- **API Documentation (Swagger UI)**: Navigate to `http://localhost:8000/docs` to see and test all available endpoints manually.
