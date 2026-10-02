import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The session cookie's format, signing and verification -- pure functions,
 * no request or database access, so both lib/auth.ts (inside the app) and
 * proxy.ts (before the app renders) can use them.
 *
 * Token: `<patientId>.<role>.<base64url HMAC-SHA256 of "patientId.role">`
 */

export const SESSION_COOKIE = "mm_session";

export type SessionRole = "patient" | "caregiver";
export type SessionClaims = { patientId: string; role: SessionRole };

export function signSession(claims: SessionClaims, secret: string): string {
  const payload = `${claims.patientId}.${claims.role}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

/**
 * Returns the claims if the token is well-formed and correctly signed, else
 * null. A forged patient id cannot survive the signature check, which is
 * what stops one patient reading another's data.
 */
export function verifySession(token: string | undefined, secret: string | undefined): SessionClaims | null {
  if (!token || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [patientId, role, signature] = parts;
  if (role !== "patient" && role !== "caregiver") return null;

  const expected = createHmac("sha256", secret).update(`${patientId}.${role}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { patientId, role };
}
