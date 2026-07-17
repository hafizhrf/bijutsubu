import mongoose from "mongoose";
import { env } from "../config/env.js";

let connected = false;

export async function connectControlPlane(): Promise<void> {
  if (connected) return;
  await mongoose.connect(`${env.MONGODB_URI}/app_control`);
  connected = true;
}
