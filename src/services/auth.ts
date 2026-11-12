import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

const sessionDuration = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(email: string, password: string) {
  if (!email.trim() || !password) return null;

  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) return null;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionDuration);

  await db.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt, user };
}

export async function getSessionUser(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session.user;
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;

  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
