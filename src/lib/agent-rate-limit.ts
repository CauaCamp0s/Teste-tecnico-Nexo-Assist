import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { sessionCookieName } from "./session";

export function createAgentLimiter() {
  const entries = new Map<string, { count: number; expires: number }>();
  return (
    keys: string[],
    limit: number,
    windowMs: number,
    now = Date.now(),
  ) => {
    for (const [key, entry] of entries)
      if (entry.expires <= now) entries.delete(key);
    if (keys.some((key) => (entries.get(key)?.count ?? 0) >= limit))
      return false;
    // Bound memory even when many distinct sessions/IPs arrive in one window.
    if (entries.size + keys.filter((key) => !entries.has(key)).length > 10000)
      return false;
    for (const key of keys) {
      const entry = entries.get(key) ?? { count: 0, expires: now + windowMs };
      entry.count++;
      entries.set(key, entry);
    }
    return true;
  };
}

const allow = createAgentLimiter();
function positive(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export async function allowAgentRequest() {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return false;
  const keys = [`session:${createHash("sha256").update(token).digest("hex")}`];
  // Enable only behind a proxy that overwrites this header, never appends user input.
  if (process.env.TRUST_PROXY === "true") {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
    keys.push(`ip:${ip || "unknown"}`);
  }
  return allow(
    keys,
    positive(process.env.AGENT_RATE_LIMIT_MAX, 10),
    positive(process.env.AGENT_RATE_LIMIT_WINDOW_MS, 60000),
  );
}
