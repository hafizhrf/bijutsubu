import mongoose, { Schema, InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true },
    dbName: { type: String, required: true },
    // Per-user Dify knowledge-base dataset. Server-derived (lazily created on
    // first KB upload) and never accepted from the client — same trust model
    // as dbName.
    difyDatasetId: { type: String },
  },
  { timestamps: true },
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const User = mongoose.model("User", userSchema);
