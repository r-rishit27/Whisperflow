import { z } from "zod";

/**
 * Server environment, validated once at module load so a bad connection
 * string fails at boot rather than on the first query.
 *
 * There is no NEXT_PUBLIC_* config here on purpose: the database is
 * reached over a Postgres connection string, which must never be
 * shipped to a browser.
 */
const serverSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "must be a postgres:// URL"),
  OPENAI_API_KEY: z.string().min(1),

  // Signs the session cookie. Rotating it signs everyone out.
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
});

export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser.");
  }

  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment:\n  ${problems}`);
  }
  return result.data;
}
