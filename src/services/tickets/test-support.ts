import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../../../prisma/seed-data";
import type { TicketContent } from "./types";

export const content: TicketContent = {
  title: "VPN sem acesso",
  description: "Erro 809 no Windows 11.",
  type: "INC",
  category: "NETWORK_VPN",
  priority: "HIGH",
  impact: "SELF",
};

export async function createTicketFixture() {
  const directory = await mkdtemp(join(tmpdir(), "nexo-ticket-writes-"));
  const databaseUrl = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
  );
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  let now = new Date("2026-11-12T14:00:00-03:00");
  await seedDatabase(db, now);
  const ana = (
    await db.user.findUniqueOrThrow({
      where: { email: "ana.souza@nexo.com.br" },
    })
  ).id;
  const bruno = (
    await db.user.findUniqueOrThrow({
      where: { email: "bruno.tavares@nexo.com.br" },
    })
  ).id;
  return {
    db,
    ana,
    bruno,
    conversationId: "ana-conversation",
    otherConversationId: "bruno-conversation",
    clock: () => new Date(now),
    setNow: (value: Date) => {
      now = new Date(value);
    },
    async reset() {
      now = new Date("2026-11-12T14:00:00-03:00");
      await db.ticketDraft.deleteMany();
      await db.ticketOperation.deleteMany();
      await db.ticketSequence.deleteMany();
      await db.conversation.deleteMany();
      await db.ticket.deleteMany();
      await seedDatabase(db, now);
      await db.conversation.createMany({
        data: [
          { id: "ana-conversation", employeeId: ana },
          { id: "bruno-conversation", employeeId: bruno },
        ],
      });
    },
    async close() {
      await db.$disconnect();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export type TicketFixture = Awaited<ReturnType<typeof createTicketFixture>>;
