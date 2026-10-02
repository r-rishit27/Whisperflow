import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { sql, type AppRole } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session-token";
import { LANGUAGE_COOKIE } from "@/lib/i18n";
import { LANGUAGES, type Language } from "@/lib/schema";

/**
 * Password and session handling.
 *
 * We are not using Supabase Auth -- the app talks to Postgres over a
 * connection string -- so this module is the whole authentication story:
 * scrypt password hashing, and an HMAC-signed session cookie whose payload
 * feeds `withPatient()` and therefore the RLS policies.
 */

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days; elderly users should not be logged out weekly.

// ---------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------

/** Stored as `scrypt:<salt-hex>:<hash-hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  // Hash regardless of whether the account exists, so a missing patient and
  // a wrong password take the same time to answer.
  const [scheme, saltHex, hashHex] = (stored ?? "").split(":");
  const salt = Buffer.from(saltHex ?? "00".repeat(16), "hex");
  const expected = Buffer.from(hashHex ?? "00".repeat(KEY_LENGTH), "hex");

  const actual = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  if (scheme !== "scrypt" || expected.length !== actual.length) return false;
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------

export type Session = { patientId: string; role: AppRole };

export async function createSession(session: Session): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, signSession(session, serverEnv().SESSION_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Reads and verifies the session cookie (see lib/session-token.ts, shared
 * with proxy.ts). Returns null if it is absent, tampered with, or
 * malformed.
 */
export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(raw, serverEnv().SESSION_SECRET);
}

/** For pages and actions that must have a signed-in patient. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  return session;
}

// ---------------------------------------------------------------------
// Registration and sign-in
// ---------------------------------------------------------------------

/**
 * Failures are codes, not sentences, so each screen can show them in the
 * patient's language (login.errors in lib/i18n.ts).
 */
export type AuthErrorCode = "notFound" | "alreadyRegistered" | "mismatch" | "badShareCode";
export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode };

/**
 * Remembers the UI language in its own cookie. Not a secret and not
 * signed -- it only picks which dictionary to show -- and it lets loading
 * screens render in the right language without a database lookup.
 */
export async function setLanguageCookie(language: Language): Promise<void> {
  if (!LANGUAGES.includes(language)) return;
  (await cookies()).set(LANGUAGE_COOKIE, language, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** The patient's language, read before an identity exists (sign-in). */
async function languageOf(patientId: string): Promise<Language | null> {
  const rows = await sql<{ language: Language }[]>`
    select language from app.auth_language(${patientId}::uuid)
  `.catch(() => []);
  return rows.at(0)?.language ?? null;
}

/**
 * First-time registration: claims the empty password slot on an existing
 * patient row. `app.set_password` only fills a NULL, so this cannot be used
 * to take over an account that is already registered.
 */
export async function register(
  patientId: string,
  password: string,
): Promise<AuthResult> {
  const rows = await sql<{ id: string; password_hash: string | null }[]>`
    select * from app.auth_lookup(${patientId}::uuid)
  `;
  const patient = rows.at(0);

  if (!patient) return { ok: false, code: "notFound" };
  if (patient.password_hash) {
    return { ok: false, code: "alreadyRegistered" };
  }

  const hash = await hashPassword(password);
  const claimed = await sql<{ set_password: boolean | null }[]>`
    select app.set_password(${patientId}::uuid, ${hash}) as set_password
  `;

  // Lost a race with another registration for the same id.
  if (!claimed.at(0)?.set_password) {
    return { ok: false, code: "alreadyRegistered" };
  }

  await createSession({ patientId, role: "patient" });
  const language = await languageOf(patientId);
  if (language) await setLanguageCookie(language);
  return { ok: true };
}

export async function signIn(
  patientId: string,
  password: string,
): Promise<AuthResult> {
  const rows = await sql<{ id: string; password_hash: string | null }[]>`
    select * from app.auth_lookup(${patientId}::uuid)
  `;
  const patient = rows.at(0);

  const valid = await verifyPassword(password, patient?.password_hash ?? null);

  // One message for both failures, so this cannot be used to discover which
  // patient IDs exist.
  if (!patient || !valid) {
    return { ok: false, code: "mismatch" };
  }

  await createSession({ patientId: patient.id, role: "patient" });
  const language = await languageOf(patient.id);
  if (language) await setLanguageCookie(language);
  return { ok: true };
}

/** Caregivers sign in with the 6-character share code instead. */
export async function signInWithShareCode(code: string): Promise<AuthResult> {
  const rows = await sql<{ resolve_share_code: string | null }[]>`
    select app.resolve_share_code(${code.toUpperCase()}) as resolve_share_code
  `;
  const patientId = rows.at(0)?.resolve_share_code;

  if (!patientId) return { ok: false, code: "badShareCode" };

  await createSession({ patientId, role: "caregiver" });
  const language = await languageOf(patientId);
  if (language) await setLanguageCookie(language);
  return { ok: true };
}
