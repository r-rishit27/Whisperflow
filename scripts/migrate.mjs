/**
 * Applies schema.sql. Idempotent: safe to run again after pulling changes.
 *
 *   npm run db:migrate
 *
 * Uses ADMIN_DATABASE_URL (the owner, `postgres`), falling back to
 * DATABASE_URL. Run this before `npm run db:provision`, which grants
 * app_user access to the tables this creates.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set ADMIN_DATABASE_URL in .env to your Supabase owner connection string.");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: !url.includes(":6543"),
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});

try {
  const [{ current_user: user }] = await sql`select current_user`;
  // Simple protocol, so the whole file runs as one multi-statement batch.
  await sql.unsafe(readFileSync("schema.sql", "utf8"), [], { simple: true });
  const tables = await sql`
    select tablename from pg_tables
     where schemaname = 'public' and tablename in ('patients', 'medicines', 'dose_logs')
     order by tablename`;
  console.log(`Applied schema.sql as ${user}. Tables: ${tables.map((t) => t.tablename).join(", ")}.`);
} catch (error) {
  console.error("Migration failed:", error.message);
  if (error.position) console.error("  at character", error.position);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
