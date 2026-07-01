import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SRC_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(SRC_DIR, 'data');
export const UPLOAD_DIR = path.join(SRC_DIR, 'uploads');
export const DB_FILE = path.join(DATA_DIR, 'db.json');

export function ensureRuntimeDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

ensureRuntimeDirectories();
