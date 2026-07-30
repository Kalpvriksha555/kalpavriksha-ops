import multer from 'multer';
import { nanoid } from 'nanoid';
import { UPLOAD_TEMP_DIR } from '../config/paths.js';

export const safeName = (name='file') => String(name).replace(/[^a-zA-Z0-9.\-_]/g, '_');

// This middleware only receives files into a private temporary directory.
// Routes must call fileStorageService.validateAndStore before using a file.
export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TEMP_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(12)}-${safeName(file.originalname || 'incoming')}.upload`)
  }),
  limits: {
    fileSize: Math.max(1, Math.min(500, Number(process.env.MAX_UPLOAD_SIZE_MB || 100))) * 1024 * 1024,
    files: Math.max(1, Math.min(100, Number(process.env.MAX_UPLOAD_FILES || 20))),
    fields: 100
  }
});
