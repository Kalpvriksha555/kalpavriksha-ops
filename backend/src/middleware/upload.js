import multer from 'multer';
import { nanoid } from 'nanoid';
import { UPLOAD_DIR } from '../config/paths.js';

export const safeName = (name='file') => String(name).replace(/[^a-zA-Z0-9.\-_]/g, '_');

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(6)}-${safeName(file.originalname)}`)
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});
