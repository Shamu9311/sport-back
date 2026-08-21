import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.test');

dotenv.config({ path: envPath, override: true });

process.env.NODE_ENV = 'test';
