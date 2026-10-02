"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { register, signIn, signInWithShareCode, destroySession } from "@/lib/auth";
import type { Dictionary } from "@/lib/i18n";

/** Error keys into login.errors, so the form shows them translated. */
export type LoginErrorKey = keyof Dictionary["login"]["errors"];
export type LoginState = { error?: LoginErrorKey } | undefined;

const credentials = z.object({
  patientId: z.string().trim().uuid({ error: "idFormat" }),
  password: z
    .string()
    .min(8, { error: "passwordShort" })
    .max(200, { error: "passwordLong" }),
});

const shareCode = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[2-9A-HJ-NP-Z]{6}$/, { error: "codeFormat" }),
});

const firstError = (error: z.ZodError): LoginErrorKey =>
  (error.issues[0]?.message as LoginErrorKey) ?? "generic";

export async function registerAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentials.safeParse({
    patientId: formData.get("patientId"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  if (formData.get("confirm") !== parsed.data.password) {
    return { error: "confirmMismatch" };
  }

  const result = await register(parsed.data.patientId, parsed.data.password);
  if (!result.ok) return { error: result.code };

  redirect("/");
}

export async function signInAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentials.safeParse({
    patientId: formData.get("patientId"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const result = await signIn(parsed.data.patientId, parsed.data.password);
  if (!result.ok) return { error: result.code };

  redirect("/");
}

/** Family members join with a share code and get read-mostly access. */
export async function shareCodeAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = shareCode.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const result = await signInWithShareCode(parsed.data.code);
  if (!result.ok) return { error: result.code };

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
