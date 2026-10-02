import "server-only";

import { headers } from "next/headers";

/**
 * The public origin for links that leave the app (the family share link).
 *
 * APP_URL wins when set -- set it in production, since request headers
 * behind some proxies report an internal host. Otherwise it is rebuilt from
 * the request, which is right in development and on Vercel.
 */
export async function getOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
