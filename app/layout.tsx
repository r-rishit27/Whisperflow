import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { ReminderManager } from "@/components/reminders/reminder-manager";
import { LanguageProvider } from "@/components/i18n-provider";
import { getCurrentSession, getLanguage } from "@/lib/current";
import { getDictionary } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "MediMantra",
  description: "A calm, simple medicine manager for elderly people and their families.",
  applicationName: "MediMantra",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available; elderly users rely on it.
  maximumScale: 5,
  themeColor: "#0f766e",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, language] = await Promise.all([getCurrentSession(), getLanguage()]);
  const t = getDictionary(language);

  return (
    <html lang={language}>
      <body className="min-h-dvh bg-surface text-ink">
        <LanguageProvider language={language}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-accent focus:px-5 focus:py-3 focus:text-accent-ink"
          >
            {t.appName}
          </a>

          {/* Phone: content above a bottom tab bar (pb-nav). Desktop: the bar
              becomes a left sidebar, and globals.css shifts main across. */}
          <main id="main" className="w-full px-5 pt-6 pb-nav md:px-8 lg:pt-10">
            <div className="mx-auto w-full max-w-screen-sm md:max-w-2xl lg:max-w-6xl">
              {/* Reminders are for the patient's own device, not family's. */}
              {session?.role === "patient" ? <ReminderManager /> : null}
              {children}
            </div>
          </main>

          <BottomNav signedIn={Boolean(session)} />
        </LanguageProvider>
      </body>
    </html>
  );
}
