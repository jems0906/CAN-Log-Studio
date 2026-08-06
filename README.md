# CAN Log Studio

CAN Log Studio is a debugging dashboard for vehicle CAN traffic. It ingests log files, decodes signals using a DBC-style JSON mapping, visualizes the resulting telemetry, replays frames at adjustable speed, and highlights error frames or suspicious signal spikes.

## Stack

- Frontend: React + Vite + TypeScript
- Backend: FastAPI + SQLAlchemy
- Database: PostgreSQL in deployment, SQLite as a local fallback
- Charts: Recharts

## Local development

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to the FastAPI backend.

### Local database behavior

By default, the backend uses in-memory SQLite for local runs, so it does not create `backend/canlogstudio.db`.

To use a persistent local SQLite file instead:

```powershell
$env:DATABASE_URL = "sqlite:///./canlogstudio.db"
```

To use PostgreSQL, set `DATABASE_URL` (see `.env.example`).

## Mapping format

The decoder expects a JSON mapping shaped like this:

```json
{
  "messages": {
    "0x100": {
      "name": "Vehicle Speed",
      "signals": [
        {
          "name": "speed_kph",
          "start_byte": 0,
          "length": 2,
          "factor": 0.1,
          "offset": 0,
          "unit": "kph"
        }
      ]
    }
  }
}
```

Supported signal fields:

- `start_byte`
- `length`
- `factor`
- `offset`
- `unit`
- `signed`
- `byte_order`

## Log formats

The parser accepts a few common shapes:

- `candump` lines such as `(1700000000.1) can0 123#11223344`
- CSV logs with columns like `timestamp`, `can_id`, `dlc`, and `data`
- JSON payloads with a `frames` array or a top-level array of frame objects

## Deployment notes

For Railway, point the backend at `DATABASE_URL` and build the frontend separately or serve it from a static host. The backend is already structured to work with PostgreSQL when the environment variable is provided.

## Railway deployment (single service)

This repository can run as one Railway service using the root `Dockerfile`.
The container builds the frontend, copies it into the backend, and serves both UI and API from one process.

1. Push this repo to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Railway will detect the root `Dockerfile` and build automatically.
4. Set `DATABASE_URL` in Railway if you want persistent PostgreSQL storage.
5. Deploy.

After deploy:

- UI is served at `/`
- API is served at `/api/*`
- Health check endpoint is `/api/health`
