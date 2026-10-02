import "server-only";

import postgres from "postgres";
import { serverEnv } from "@/lib/env";

/**
 * Supabase Postgres connection, server-only.
 *
 * Use the pooler connection string from the Supabase dashboard
 * (Project Settings -> Database -> Connection string -> Transaction):
 *
 *   postgresql://app_user:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Port 6543 is the transaction-mode pooler, which does not support
 * prepared statements -- hence `prepare: false`. Port 5432 is the
 * session-mode pooler and does support them.
 *
 * Connect as `app_user`, not `postgres`: the default role has BYPASSRLS,
 * which would silently disable every policy in schema.sql.
 */

const connection = () => {
  const { DATABASE_URL } = serverEnv();
  return postgres(DATABASE_URL, {
    prepare: !DATABASE_URL.includes(":6543"),
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: "require",
  });
};

// Cached on globalThis so Next's dev-mode hot reload does not open a new
// pool on every edit.
const globalForDb = globalThis as unknown as {
  sql?: postgres.Sql;
};

/**
 * The pool is created on first use, not on import. `next build` imports
 * every module to collect page data, and connecting there would make the
 * build demand production credentials it has no business needing.
 */
export const sql: postgres.Sql = new Proxy((() => {}) as unknown as postgres.Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    const instance = (globalForDb.sql ??= connection());
    return (instance as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop, receiver) {
    const instance = (globalForDb.sql ??= connection());
    const value = Reflect.get(instance as object, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type AppRole = "patient" | "caregiver";
export type TransactionSql = postgres.TransactionSql;

/**
 * Runs `fn` in a transaction that carries an identity, so the RLS policies
 * in schema.sql can see who is asking.
 *
 * `set_local` scopes both settings to this transaction, which is what makes
 * this safe on a shared pooled connection: the values are discarded at
 * commit and cannot leak into the next request that borrows the socket.
 *
 * Anything outside this helper runs with no identity, and the policies then
 * fail closed -- queries return zero rows rather than everyone's rows.
 */
export async function withPatient<T>(
  patientId: string,
  role: AppRole,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    // set_local rejects bind parameters, so these go through set_config,
    // which takes them positionally and is injection-safe.
    await tx`select set_config('app.current_patient', ${patientId}, true)`;
    await tx`select set_config('app.current_role', ${role}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
