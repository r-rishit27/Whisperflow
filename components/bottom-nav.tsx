"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, ScanLine, Mic, Users, Pill } from "lucide-react";
import { useT } from "@/components/i18n-provider";

const TABS = [
  { href: "/", key: "today", Icon: CalendarCheck },
  { href: "/scan", key: "scan", Icon: ScanLine },
  { href: "/voice", key: "voice", Icon: Mic },
  { href: "/family", key: "family", Icon: Users },
] as const;

// Routes that are a full-screen flow, where the tab bar would be a
// distraction or lead nowhere useful.
const HIDDEN_ON = ["/onboarding", "/login", "/welcome"];

/**
 * Bottom tab bar on phones and tablets; a left sidebar from 1024px. Carries
 * `data-app-nav`, which globals.css uses to make room for it.
 */
export function BottomNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const t = useT();

  // The public family dashboard is for people without an account.
  const isPublicFamilyPage = /^\/family\/[^/]+/.test(pathname);
  if (!signedIn || isPublicFamilyPage || HIDDEN_ON.some((route) => pathname.startsWith(route))) {
    return null;
  }

  return (
    <nav
      data-app-nav
      aria-label={t.nav.label}
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-(--spacing-sidebar) lg:border-t-0 lg:border-r-2 lg:pb-0"
    >
      <p className="hidden items-center gap-3 px-7 pt-10 pb-8 text-2xl font-bold text-accent lg:flex">
        <Pill aria-hidden="true" className="size-8 shrink-0" />
        {t.appName}
      </p>

      <ul className="mx-auto flex max-w-screen-sm lg:mx-0 lg:max-w-none lg:flex-col lg:gap-2 lg:px-4">
        {TABS.map(({ href, key, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <li key={href} className="flex-1 lg:flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-nav flex-col items-center justify-center gap-1.5 px-2 py-3 text-base font-semibold transition-colors lg:min-h-0 lg:flex-row lg:justify-start lg:gap-4 lg:rounded-2xl lg:px-4 lg:py-4 lg:text-xl ${
                  active
                    ? "bg-teal-50 text-accent"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                }`}
              >
                <Icon
                  aria-hidden="true"
                  strokeWidth={active ? 2.5 : 2}
                  className="size-8 shrink-0"
                />
                {t.nav[key]}
                {/* Active state is signalled by colour, weight and this
                    underline, so it does not rely on colour alone. */}
                <span
                  aria-hidden="true"
                  className={`h-1 w-8 rounded-full lg:ml-auto lg:h-8 lg:w-1 ${active ? "bg-accent" : "bg-transparent"}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
