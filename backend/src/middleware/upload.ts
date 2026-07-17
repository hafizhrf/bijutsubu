import multer from "multer";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIME_TYPES,
  KB_ALLOWED_EXTENSIONS,
  KB_ALLOWED_MIME_TYPES,
  UPLOAD_MAX_FILE_SIZE_BYTES,
} from "../config/rateLimit.js";

export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = `.${file.originalname.toLowerCase().split(".").pop()}`;
    const mimeOk = ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype);
    const extOk = ALLOWED_UPLOAD_EXTENSIONS.has(ext);
    if (mimeOk || extOk) {
      cb(null, true);
    } else {
      cb(new Error("unsupported_file_type"));
    }
  },
}).single("file");

/** Knowledge-base uploads: any Dify-indexable document, images hard-rejected. */
export const kbUploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = `.${file.originalname.toLowerCase().split(".").pop()}`;
    const isImage = file.mimetype.startsWith("image/");
    const allowed =
      !isImage && (KB_ALLOWED_MIME_TYPES.has(file.mimetype) || KB_ALLOWED_EXTENSIONS.has(ext));
    if (allowed) {
      cb(null, true);
    } else {
      cb(new Error("unsupported_file_type"));
    }
  },
}).single("file");
