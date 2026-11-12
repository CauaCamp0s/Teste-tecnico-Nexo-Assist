"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, revokeSession } from "@/services/auth";
import {
  homeForRole,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/session";

export async function login(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    redirect("/login?error=credentials");
  }

  const session = await createSession(email, password);
  if (!session) redirect("/login?error=credentials");

  const cookieStore = await cookies();
  await revokeSession(cookieStore.get(sessionCookieName)?.value);
  cookieStore.set(
    sessionCookieName,
    session.token,
    sessionCookieOptions(session.expiresAt),
  );
  redirect(homeForRole(session.user.role));
}

export async function logout() {
  const cookieStore = await cookies();
  await revokeSession(cookieStore.get(sessionCookieName)?.value);
  cookieStore.delete(sessionCookieName);
  redirect("/login");
}
