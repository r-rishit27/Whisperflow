import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

/**
 * Sign-in routing, decided before any page renders (Next 16 "proxy", the
 * renamed middleware).
 *
 * Doing this here rather than in each page matters because every page sits
 * under a streaming loading screen: once streaming starts, a page-level
 * redirect() can only be a client-side hop with a 200 status. Here it is a
 * real 307, sent before a single byte of the page.
 *
 * This only checks the cookie's signature. Pages still check that the
 * patient exists, and every server action checks its own session.
 */

// Screens that need a signed-in patient or family member.
const SIGNED_IN_ONLY = new Set(["/", "/scan", "/voice", "/family", "/welcome"]);

export function proxy(request: NextRequest) {
  // Only page loads. Server actions and API routes authorise themselves,
  // and redirecting a form POST would lose it.
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;
  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (!session && SIGNED_IN_ONLY.has(pathname)) return to("/onboarding");

  // Onboarding is one-time; sign-in is pointless once signed in -- except
  // the patient setting a password straight after onboarding.
  if (session && pathname === "/onboarding") return to("/");
  if (session && pathname === "/login") {
    const registering = session.role === "patient" && searchParams.get("tab") === "register";
    if (!registering) return to("/");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/scan", "/voice", "/family", "/welcome", "/onboarding", "/login"],
};
