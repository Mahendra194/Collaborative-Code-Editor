import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Shared Redis client for active room state.
const redis = new Redis(REDIS_URL);

redis.on("connect", () => {
  console.log("Redis connected");
});

// Log connection errors but don't crash the server — the app can still
// serve REST traffic if Redis is temporarily unavailable.
redis.on("error", (err) => {
  console.error("Redis error:", err.message);
});

export default redis;
