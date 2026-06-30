import redis from "../config/redis.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Room } from "../models/Room.js";
import { CodeEvent } from "../models/CodeEvent.js";

// Redis keys for a room's active state.
const codeKey = (roomId) => `room:${roomId}:code`;
const langKey = (roomId) => `room:${roomId}:language`;
const usersKey = (roomId) => `room:${roomId}:users`;

// Active room state evicts after 30 minutes of inactivity.
const TTL_SECONDS = 1800;

// Persisting a full code snapshot on every keystroke would flood MongoDB.
// Instead we checkpoint at most once per this interval per room — frequent
// enough for a meaningful replay, cheap enough to run during live editing.
const SNAPSHOT_INTERVAL_MS = 3000;

// roomId → epoch ms of the last persisted snapshot, for throttling.
const lastSnapshotAt = new Map();

// Persist a full code snapshot to MongoDB if enough time has passed since the
// last one for this room. Also bumps Room.lastActiveAt so dashboards order by
// genuine activity. Errors are swallowed — replay is best-effort and must
// never break live editing.
const maybeSnapshot = async (roomId, code, userId) => {
  const now = Date.now();
  const last = lastSnapshotAt.get(roomId) ?? 0;
  if (now - last < SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotAt.set(roomId, now);

  try {
    await CodeEvent.create({ roomId, userId, code });
    await Room.updateOne({ roomId }, { lastActiveAt: now });
  } catch (err) {
    console.error("snapshot error:", err.message);
  }
};

// Maps socket.id → { roomId, userId } so we know who/where to clean up
// on disconnect (the disconnect event carries no payload from the client).
const socketIdentity = new Map();

// Refresh the TTL on all three keys so an active room stays alive and
// evicts together once it goes idle.
const touchTTL = async (roomId) => {
  await Promise.all([
    redis.expire(codeKey(roomId), TTL_SECONDS),
    redis.expire(langKey(roomId), TTL_SECONDS),
    redis.expire(usersKey(roomId), TTL_SECONDS),
  ]);
};

// Removes a user from a room's users list (in Redis) and notifies the room.
// Uses KEEPTTL so the keys keep their remaining TTL and evict naturally —
// we never delete keys here, even when the room becomes empty.
const removeUser = async (socket, roomId, userId) => {
  try {
    const usersRaw = await redis.get(usersKey(roomId));
    const users = usersRaw ? JSON.parse(usersRaw) : [];
    // Dedup via a Map keyed by userId so concurrent join/leave operations
    // can't leave duplicate or stale entries behind.
    const usersMap = new Map(users.map((u) => [u.userId, u]));
    usersMap.delete(userId);
    const dedupedUsers = Array.from(usersMap.values());
    await redis.set(usersKey(roomId), JSON.stringify(dedupedUsers), "KEEPTTL");
  } catch (err) {
    console.error("removeUser error:", err.message);
  }
  socket.to(roomId).emit("user_left", { userId });
};

export const registerRoomEvents = (io) => {
  io.on("connection", (socket) => {
    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        const [storedCode, storedLang, usersRaw] = await redis.mget(
          codeKey(roomId),
          langKey(roomId),
          usersKey(roomId)
        );

        const code = storedCode ?? "";
        const language = storedLang ?? "javascript";

        // Add the joining user to the room's users list. A Map keyed by
        // userId dedups so rapid refreshes / rejoins that left stale entries
        // (before their disconnect events fired) can't produce duplicates.
        const existingUsers = usersRaw ? JSON.parse(usersRaw) : [];

        // Enforce room capacity before letting the user in. A rejoin from a
        // user already in the room (refresh/reconnect) is always allowed and
        // doesn't count against capacity.
        const alreadyInRoom = existingUsers.some((u) => u.userId === userId);
        if (!alreadyInRoom) {
          const roomDoc = await Room.findOne({ roomId });
          const maxUsers = roomDoc?.maxUsers ?? 10;
          if (existingUsers.length >= maxUsers) {
            socket.emit("room_full");
            return;
          }
        }

        socket.join(roomId);

        // Remember this socket's identity so we can clean up on disconnect
        socket.data.roomId = roomId;
        socket.data.userId = userId;
        socket.data.username = username;
        socketIdentity.set(socket.id, { roomId, userId });

        const usersMap = new Map(existingUsers.map((u) => [u.userId, u]));
        usersMap.set(userId, { userId, username });
        const users = Array.from(usersMap.values());

        // Persist current state, then (re)set TTL on all three keys.
        await redis.set(codeKey(roomId), code);
        await redis.set(langKey(roomId), language);
        await redis.set(usersKey(roomId), JSON.stringify(users));
        await touchTTL(roomId);

        // Send current state + existing users to the joining user only
        console.log(
          `[join_room] roomId=${roomId} storedLang=${JSON.stringify(
            storedLang
          )} emitting language=${JSON.stringify(language)}`
        );
        socket.emit("room_state", { code, language, users });

        // Notify others in the room
        socket.to(roomId).emit("user_joined", { userId, username });
      } catch (err) {
        console.error("join_room error:", err.message);
      }
    });

    socket.on("chat_message", async ({ roomId, userId, username, message }) => {
      const text = (message ?? "").trim();
      if (!roomId || !text) return;

      const timestamp = new Date();
      try {
        await ChatMessage.create({
          roomId,
          userId,
          username,
          message: text,
          type: "user",
          timestamp,
        });
      } catch (err) {
        console.error("chat_message save error:", err.message);
      }

      // Broadcast to the entire room (including the sender)
      io.to(roomId).emit("chat_message", {
        userId,
        username,
        message: text,
        type: "user",
        timestamp,
      });
    });

    socket.on("leave_room", async ({ roomId, userId }) => {
      socket.leave(roomId);
      // Forget this socket's identity so the later disconnect event doesn't
      // run removeUser a second time and emit a redundant user_left.
      socketIdentity.delete(socket.id);
      await removeUser(socket, roomId, userId);
    });

    socket.on("code_change", async ({ roomId, code, userId }) => {
      try {
        await redis.set(codeKey(roomId), code);
        await touchTTL(roomId);
      } catch (err) {
        console.error("code_change error:", err.message);
      }

      // Checkpoint a snapshot for session replay (throttled internally).
      maybeSnapshot(roomId, code, userId);

      // Broadcast to everyone EXCEPT sender
      socket.to(roomId).emit("code_update", { code, userId });
    });

    socket.on("cursor_move", ({ roomId, userId, position }) => {
      socket.to(roomId).emit("cursor_update", { userId, position });
    });

    socket.on("language_change", async ({ roomId, language }) => {
      try {
        // Preserve the existing TTL — language change isn't a TTL reset.
        await redis.set(langKey(roomId), language, "KEEPTTL");
      } catch (err) {
        console.error("language_change error:", err.message);
      }

      // Broadcast to entire room including sender
      io.to(roomId).emit("language_updated", { language });
    });

    socket.on("disconnect", async () => {
      const identity = socketIdentity.get(socket.id);
      if (identity) {
        const { roomId, userId } = identity;
        socketIdentity.delete(socket.id);
        await removeUser(socket, roomId, userId);
      }
    });
  });
};
