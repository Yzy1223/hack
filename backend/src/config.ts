import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(backendRoot, '.env'), quiet: true });
export const config = {
  container: process.env.WORKBENCH_CONTAINER === '1',
  accessPassword: process.env.WORKBENCH_PASSWORD || '',
  port: Number(process.env.PORT || 4310),
  dataPath: path.join(backendRoot, 'data', 'workbench.sqlite'),
  catalogPath: path.resolve(backendRoot, process.env.CATALOG_PATH ||
    (existsSync(path.resolve(backendRoot, '../../gushi')) ? '../../gushi' : '../catalog')),
  deskcommUrl: process.env.DESKCOMM_URL?.replace(/\/$/, '') || '',
  apiToken: process.env.DESKCOMM_API_TOKEN || '',
  sessionCookie: process.env.DESKCOMM_SESSION_COOKIE || '',
};
