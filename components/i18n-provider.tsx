"use client";

import { createContext, useContext } from "react";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/schema";

/**
 * Hands the UI language to client components. Only the language code
 * crosses the server/client boundary; the dictionary (which contains
 * functions) is imported on each side.
 */
const LanguageContext = createContext<Language>("en");

export function LanguageProvider({
  language,
  children,
}: {
  language: Language;
  children: React.ReactNode;
}) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

export function useT(): Dictionary {
  return getDictionary(useContext(LanguageContext));
}
