import type { UserRole } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/services/auth";

export const sessionCookieName = "nexo_session";

export function homeForRole(role: UserRole) {
  return role === "ANALYST" ? "/console" : "/chat";
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

export async function currentUser() {
  const cookieStore = await cookies();
  return getSessionUser(cookieStore.get(sessionCookieName)?.value);
}

export async function requireRole(role: UserRole) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(homeForRole(user.role));
  return user;
}
