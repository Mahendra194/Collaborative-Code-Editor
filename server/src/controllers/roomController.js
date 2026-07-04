import { v4 as uuidv4 } from "uuid";
import { Room } from "../models/Room.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { CodeEvent } from "../models/CodeEvent.js";
import redis from "../config/redis.js";
import { kickUser as kickUserSocket } from "../socket/roomSocket.js";

// POST /api/rooms/create  (protected)
export const createRoom = async (req, res) => {
  try {
    const { name, language } = req.body;

    const room = await Room.create({
      roomId: uuidv4(),
      name: name?.trim() || "Untitled Room",
      owner: req.user._id,
      language: language || "javascript",
    });

    return res.status(201).json({ room });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// GET /api/rooms/my-rooms  (protected)
export const getMyRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ owner: req.user._id }).sort({
      lastActiveAt: -1,
    });
    return res.status(200).json({ rooms });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// GET /api/rooms/:roomId  (public)
export const getRoom = async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId }).populate(
      "owner",
      "name email avatar"
    );
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }
    return res.status(200).json({ room });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// DELETE /api/rooms/:roomId  (protected, owner only)
export const deleteRoom = async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }
    if (room.owner.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only the room owner can delete this room" });
    }

    await room.deleteOne();
    return res.status(200).json({ message: "Room deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// GET /api/rooms/:roomId/chat  (protected) — last 50 messages, oldest first
export const getChatHistory = async (req, res) => {
  try {
    // Grab the 50 most recent, then reverse to ascending chronological order.
    const recent = await ChatMessage.find({ roomId: req.params.roomId })
      .sort({ timestamp: -1 })
      .limit(50);
    const messages = recent.reverse();
    return res.status(200).json({ messages });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// GET /api/rooms/:roomId/history  (protected) — chronological code snapshots
// for session replay. Returns full code per event so the client can scrub
// instantly without a round-trip per step. Capped to the most recent events
// to bound the payload on long sessions.
const HISTORY_LIMIT = 500;

export const getHistory = async (req, res) => {
  try {
    // Grab the most recent snapshots, then reverse to ascending order so the
    // replay scrubs from session start to finish.
    const recent = await CodeEvent.find({ roomId: req.params.roomId })
      .sort({ timestamp: -1 })
      .limit(HISTORY_LIMIT)
      .populate("userId", "name");
    const events = recent.reverse().map((e) => ({
      _id: e._id,
      userId: e.userId?._id ?? null,
      username: e.userId?.name ?? "Unknown",
      code: e.code,
      timestamp: e.timestamp,
    }));
    return res.status(200).json({ events });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// POST /api/rooms/:roomId/history/snapshot  (protected) — manually checkpoint
// the room's current code. Pulls the live code from Redis so the snapshot
// reflects exactly what collaborators see right now.
export const createSnapshot = async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const code = (await redis.get(`room:${roomId}:code`)) ?? "";
    const event = await CodeEvent.create({
      roomId,
      userId: req.user._id,
      code,
    });
    await Room.updateOne({ roomId }, { lastActiveAt: Date.now() });

    return res.status(201).json({ event });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// PATCH /api/rooms/:roomId/lock  (protected, owner only) — toggles isLocked
export const toggleLock = async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }
    if (room.owner.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only the room owner can lock this room" });
    }

    room.isLocked = !room.isLocked;
    room.lastActiveAt = Date.now();
    await room.save();

    return res.status(200).json({ room });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

// POST /api/rooms/:roomId/kick/:userId  (protected, owner only) — removes the
// target user from the room and notifies them via the socket layer.
export const kickUser = async (req, res) => {
  try {
    const { roomId, userId } = req.params;
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }
    if (room.owner.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only the room owner can kick users" });
    }
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot kick yourself" });
    }

    await kickUserSocket(roomId, userId);
    return res.status(200).json({ message: "User kicked" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};
