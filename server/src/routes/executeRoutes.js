import { Router } from "express";
import rateLimit from "express-rate-limit";
import { execute } from "../controllers/executeController.js";
import { protect } from "../middleware/auth.js";

// Max 10 executions per minute per IP.
const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many executions — please wait a minute and try again.",
  },
});

const router = Router();

router.post("/", protect, executeLimiter, execute);

export default router;
