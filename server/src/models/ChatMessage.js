import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
  },
  // System messages ("X joined") have no associated user.
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  username: {
    type: String,
    default: "",
  },
  message: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["user", "system"],
    default: "user",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Fast chronological history queries per room.
chatMessageSchema.index({ roomId: 1, timestamp: 1 });

export const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);
