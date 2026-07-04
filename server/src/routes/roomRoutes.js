import { Router } from "express";
import {
  createRoom,
  getMyRooms,
  getRoom,
  getChatHistory,
  getHistory,
  createSnapshot,
  deleteRoom,
  toggleLock,
  kickUser,
} from "../controllers/roomController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.post("/create", protect, createRoom);
// Keep static paths above the dynamic ":roomId" so they aren't
// swallowed by the param route.
router.get("/my-rooms", protect, getMyRooms);

router.get("/:roomId", getRoom); // public
router.get("/:roomId/chat", protect, getChatHistory);
router.get("/:roomId/history", protect, getHistory);
router.post("/:roomId/history/snapshot", protect, createSnapshot);
router.delete("/:roomId", protect, deleteRoom);
router.patch("/:roomId/lock", protect, toggleLock);
router.post("/:roomId/kick/:userId", protect, kickUser);

export default router;
