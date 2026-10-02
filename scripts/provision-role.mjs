/**
 * Creates the `app_user` role the application connects as, with the grants
 * from schema.sql and nothing more.
 *
 *   node --env-file=.env scripts/provision-role.mjs
 *
 * Connects as the owner via ADMIN_DATABASE_URL (falling back to
 * DATABASE_URL). Prints the connection string for the new role; the
 * password is generated here and shown once.
 *
 * Re-running rotates the password and re-applies the grants.
 */

import { randomBytes } from "node:crypto";
import postgres from "postgres";

const adminUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  console.error("Set ADMIN_DATABASE_URL (or DATABASE_URL) to an owner connection.");
  process.exit(1);
}

// URL-safe, so it survives being embedded in a connection string.
const password = randomBytes(24).toString("base64url");

const sql = postgres(adminUrl, {
  prepare: !adminUrl.includes(":6543"),
  ssl: "require",
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});

try {
  const [{ current_user: owner }] = await sql`select current_user`;
  console.log(`Connected as ${owner}.`);

  await sql.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'app_user') then
        create role app_user with login noinherit;
      end if;
    end $$;
  `);
  // ALTER ROLE takes no bind parameters, so the password is inlined. It is
  // base64url from randomBytes, so it contains no quote to escape -- the
  // replace is belt and braces.
  await sql.unsafe(
    `alter role app_user with login password '${password.replace(/'/g, "''")}'`,
  );
  console.log("Role app_user created (password set).");

  // Deliberately narrow: no CREATE, no schema-wide function execute, and no
  // BYPASSRLS -- that last one is the whole point.
  await sql.unsafe(`
    grant usage on schema public, app to app_user;
    grant select, insert, update, delete on patients, medicines, dose_logs to app_user;
    grant execute on function
      app.current_patient(), app.current_role(),
      app.create_patient(text, patient_language, text, text, char),
      app.auth_lookup(uuid),
      app.auth_language(uuid),
      app.set_password(uuid, text),
      app.resolve_share_code(char)
      to app_user;
  `);
  console.log("Grants applied.");

  const [role] = await sql`
    select rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
      from pg_roles where rolname = 'app_user'
  `;
  const safe =
    role.rolbypassrls === false &&
    role.rolsuper === false &&
    role.rolcreaterole === false;
  console.log(
    `Privilege check: bypassrls=${role.rolbypassrls} super=${role.rolsuper} createrole=${role.rolcreaterole} -> ${safe ? "OK, policies apply" : "PROBLEM"}`,
  );

  const url = new URL(adminUrl);
  url.username = "app_user";
  url.password = password;
  console.log("\nPut this in .env as DATABASE_URL:\n");
  console.log(`DATABASE_URL=${url.toString()}`);
} catch (error) {
  console.error("\nFAILED:", error.message);
  if (error.detail) console.error("  detail:", error.detail);
  if (error.hint) console.error("  hint:", error.hint);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
