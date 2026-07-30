import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SRC_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.KALPA_DATA_DIR ? path.resolve(process.env.KALPA_DATA_DIR) : path.join(SRC_DIR, 'data');
export const LEGACY_UPLOAD_DIR = process.env.KALPA_LEGACY_UPLOAD_DIR
  ? path.resolve(process.env.KALPA_LEGACY_UPLOAD_DIR)
  : (process.env.KALPA_UPLOAD_DIR ? path.resolve(process.env.KALPA_UPLOAD_DIR) : path.join(SRC_DIR, 'uploads'));
export const FILE_STORAGE_ROOT = process.env.KALPA_FILE_STORAGE_ROOT
  ? path.resolve(process.env.KALPA_FILE_STORAGE_ROOT)
  : path.join(DATA_DIR, 'private-files');
export const UPLOAD_TEMP_DIR = path.join(FILE_STORAGE_ROOT, '.incoming');
export const DB_FILE = process.env.KALPA_DB_FILE ? path.resolve(process.env.KALPA_DB_FILE) : path.join(DATA_DIR, 'db.json');

export function ensureRuntimeDirectories() {
  for (const directory of [DATA_DIR, LEGACY_UPLOAD_DIR, FILE_STORAGE_ROOT, UPLOAD_TEMP_DIR]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
  }
}

ensureRuntimeDirectories();
