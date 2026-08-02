import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv, requireEnv } from "@beacon/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const env = loadEnv();
  const dbUrl = requireEnv(env, "DATABASE_URL_DIRECT");
  const sqlPath = path.join(__dirname, "..", "db", "migrations", "001_init.sql");
  const sql = readFileSync(sqlPath, "utf8");

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration 001_init.sql applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
