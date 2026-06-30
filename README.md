# Collaborative Code Editor

A real-time collaborative coding platform where multiple users join a shared room to write and edit code together, see each other's live cursors, chat, run code in 40+ languages, and replay the entire session from start to finish.

## Tech Stack

- **Frontend:** React + Vite, Monaco Editor, React Router, Axios, Socket.IO client
- **Backend:** Node.js + Express, Socket.IO
- **Database:** MongoDB (Mongoose)
- **Cache / live state:** Redis (ioredis)
- **Code execution:** Judge0 API (via RapidAPI)
- **Auth:** JWT in httpOnly cookies (bcryptjs)

## Features

- **Authentication** — register / login with JWT stored in httpOnly cookies and protected routes
- **Rooms** — create a room with a shareable link, join by link, owner can lock a room, capacity limits
- **Real-time collaborative editing** — keystrokes synced live via Socket.IO with debounced last-write-wins
- **Multi-cursor presence** — every user's cursor rendered in a distinct color with their name label
- **In-room chat** — real-time messaging persisted per room, with history on rejoin
- **Code execution** — run code through Judge0 with stdin support, output/exit-code/time, and rate limiting
- **Redis-backed active state** — current code, language, and connected users held in Redis with a 30-minute TTL
- **Session history & replay** — code snapshots logged over time; scrub through the session and restore any point

## Project Structure

```
.
├── client/   # React + Vite frontend
└── server/   # Express + Socket.IO backend
```

## Getting Started

### Prerequisites

- Node.js 18+
- A running MongoDB instance (local or MongoDB Atlas)
- A running Redis instance (local or hosted, e.g. Upstash)
- A Judge0 / RapidAPI key (for code execution)

### 1. Clone

```bash
git clone <your-repo-url>
cd "Collaborative Code Editor"
```

### 2. Install dependencies

```bash
# Backend
cd server && npm install

# Frontend
cd ../client && npm install
```

### 3. Configure environment variables

Copy the example env files and fill in your own values. **Never commit real secrets or API keys.**

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

**Server (`server/.env`):**

| Variable | Description |
|---|---|
| `PORT` | Port the backend listens on |
| `NODE_ENV` | `development` or `production` |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign JWTs (use a long random string) |
| `JWT_EXPIRES_IN` | Token lifetime (e.g. `7d`) |
| `COOKIE_NAME` | Name of the auth cookie |
| `CLIENT_URL` | Frontend origin, used for CORS |
| `REDIS_URL` | Redis connection string |
| `JUDGE0_URL` | Judge0 API base URL |
| `RAPIDAPI_KEY` | Your RapidAPI key for Judge0 |
| `RAPIDAPI_HOST` | Judge0 RapidAPI host |

**Client (`client/.env`):**

| Variable | Description |
|---|---|
| `VITE_SERVER_URL` | Backend base URL (used for both REST API and Socket.IO; the client appends `/api` for REST) |

### 4. Run

Make sure MongoDB and Redis are running first.

```bash
# Backend (from server/)
npm run dev     # development with auto-reload
npm start       # production

# Frontend (from client/)
npm run dev
```

The Vite dev server prints the local URL (default `http://localhost:5173`). Open it in your browser to start coding collaboratively.

> Code execution requires a valid Judge0 / RapidAPI key configured in `server/.env`.
