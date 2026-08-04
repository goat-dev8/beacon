import fs from "fs";
import pg from "pg";
import { Redis } from "@upstash/redis";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const db = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const stuck = await db.query(
  `SELECT id, status FROM jobs
   WHERE status IN ('GENERATING','AUTHORIZED','PREPARING','COMPOSING','ACCEPTING')
   ORDER BY updated_at ASC LIMIT 30`,
);
console.log("active", stuck.rows);
for (const row of stuck.rows) {
  await redis.del(`lock:job:${row.id}`);
  if (row.status === "GENERATING" || row.status === "ACCEPTING") {
    await db.query(`UPDATE jobs SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [
      row.id,
    ]);
    await redis.lpush("q:settle", `refuse:${row.id}`);
    console.log("failed", row.id, row.status);
  } else {
    console.log("cleared lock", row.id, row.status);
  }
}
await db.end();
