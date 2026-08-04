import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { rows } = await pool.query(
  `SELECT id, status, service_id, updated_at FROM jobs ORDER BY updated_at DESC LIMIT 8`,
);
console.log(JSON.stringify(rows, null, 2));

for (const j of rows.slice(0, 4)) {
  const { rows: ev } = await pool.query(
    `SELECT type, payload, ts FROM job_events WHERE job_id = $1 ORDER BY ts DESC LIMIT 10`,
    [j.id],
  );
  console.log("---", j.id, j.status);
  console.log(JSON.stringify(ev, null, 2));
}

await pool.end();
