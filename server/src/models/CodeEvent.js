import mongoose from "mongoose";

const codeEventSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  code: {
    type: String,
    default: "",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Fast chronological replay queries per room.
codeEventSchema.index({ roomId: 1, timestamp: 1 });

export const CodeEvent = mongoose.model("CodeEvent", codeEventSchema);
