import Database, { type Database as DatabaseType } from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { initializeSchema } from "./schema.js";
import { resolveDataPath } from "./data-path.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, "..", "..");
// Vitest runs files in parallel workers. resolveDataPath nests each worker/run
// beneath the configured test base, avoiding concurrent WAL initialization;
// outside Vitest an explicit NT_DATA_PATH remains exact and authoritative.
const dataPath = resolveDataPath(process.env, repoRoot);

mkdirSync(dataPath, { recursive: true });

const dbPath = path.join(dataPath, "candles.db");
const db: DatabaseType = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

initializeSchema(db);

export default db;
