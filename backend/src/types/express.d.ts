import "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userDbName?: string;
      userEmail?: string;
    }
  }
}
