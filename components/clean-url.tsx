"use client";

import { useEffect } from "react";

/**
 * Drops one-time query parameters (like `?added=3`) from the address bar
 * once they have been shown, so a banner is not repeated after the next
 * tap or refresh. Uses replaceState: no navigation, no re-render.
 */
export function CleanUrl({ params }: { params: string[] }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const p of params) {
      if (url.searchParams.has(p)) {
        url.searchParams.delete(p);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(window.history.state, "", url);
  }, [params]);
  return null;
}
