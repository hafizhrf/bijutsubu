import { Router } from "express";
import {
  changePassword,
  login,
  me,
  register,
  updateProfile,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", requireAuth, me);
authRouter.patch("/profile", requireAuth, updateProfile);
authRouter.post("/change-password", requireAuth, changePassword);
