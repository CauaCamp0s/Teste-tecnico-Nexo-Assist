import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createDraftService } from "./drafts";
import { createTicketService } from "./service";
import { reopenWindowMs } from "./reopening";
import {
  content,
  createTicketFixture,
  type TicketFixture,
} from "./test-support";
import type { TicketService } from "./types";

let f: TicketFixture;
let service: TicketService;
beforeAll(async () => {
  f = await createTicketFixture();
}, 30_000);
beforeEach(async () => {
  await f.reset();
  service = createTicketService(f.db, f.clock);
});
afterAll(async () => {
  await f?.close();
});

test("candidatos incluem abertos e resolvidos recentes do funcionário, sem decidir similaridade", async () => {
  const tickets = await service.findDuplicateCandidates(f.ana);
  expect(tickets.map(({ number }) => number).sort()).toEqual([
    "INC-20150",
    "INC-20311",
    "INC-20312",
    "INC-20313",
    "REQ-10442",
    "REQ-10443",
  ]);
  expect(tickets.every(({ employeeId }) => employeeId === f.ana)).toBe(true);
  expect(tickets.some(({ isOverdue }) => isOverdue)).toBe(true);
  await f.db.ticket.update({
    where: { number: "INC-20315" },
    data: { status: "RESOLVED", resolvedAt: f.clock() },
  });
  expect(
    (await service.findDuplicateCandidates(f.ana)).some(
      ({ number }) => number === "INC-20315",
    ),
  ).toBe(false);
  expect(
    (await service.findDuplicateCandidates(f.bruno)).map(
      ({ number }) => number,
    ),
  ).toEqual(["INC-20315"]);
  await expect(
    service.findDuplicateCandidates(undefined as unknown as string),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

test.each([reopenWindowMs - 1, reopenWindowMs, reopenWindowMs + 1])(
  "janela de resolução com idade de %i ms vale na busca e na reabertura",
  async (age) => {
    await f.db.ticket.update({
      where: { number: "INC-20150" },
      data: { resolvedAt: new Date(f.clock().getTime() - age) },
    });
    const allowed = age <= reopenWindowMs;
    expect(
      (await service.findDuplicateCandidates(f.ana)).some(
        ({ number }) => number === "INC-20150",
      ),
    ).toBe(allowed);
    if (allowed) {
      const reopened = await service.reopen(
        f.ana,
        "INC-20150",
        content,
        "reopen",
      );
      expect(reopened).toMatchObject({
        status: "OPEN",
        resolvedAt: null,
        lastUpdatedAt: f.clock(),
      });
      f.setNow(new Date(f.clock().getTime() + 10 * 86_400_000));
      expect(
        (await service.reopen(f.ana, "INC-20150", content, "reopen"))
          .lastUpdatedAt,
      ).toEqual(reopened.lastUpdatedAt);
    } else {
      await expect(
        service.reopen(f.ana, "INC-20150", content, "reopen"),
      ).rejects.toMatchObject({
        code: "REOPEN_NOT_ALLOWED",
        message: expect.stringContaining("7 dias"),
      });
      expect(await f.db.ticketOperation.count()).toBe(0);
    }
  },
);

test.each(["OPEN", "CLOSED", "IN_PROGRESS", "APPROVED"] as const)(
  "não reabre status %s",
  async (status) => {
    await f.db.ticket.update({
      where: { number: "INC-20150" },
      data: { status },
    });
    await expect(
      service.reopen(f.ana, "INC-20150", content, "reopen"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  },
);

test.each([null, new Date("2026-11-13T00:00:00Z")])(
  "resolução ausente ou futura é excluída e rejeitada: %s",
  async (resolvedAt) => {
    await f.db.ticket.update({
      where: { number: "INC-20150" },
      data: { resolvedAt },
    });
    expect(
      (await service.findDuplicateCandidates(f.ana)).some(
        ({ number }) => number === "INC-20150",
      ),
    ).toBe(false);
    await expect(
      service.reopen(f.ana, "INC-20150", content, "reopen"),
    ).rejects.toMatchObject({ code: "REOPEN_NOT_ALLOWED" });
  },
);

test("a confirmação revalida janela expirada antes de chamar o legado", async () => {
  const drafts = createDraftService(f.db, f.clock);
  await f.db.ticket.update({
    where: { number: "INC-20150" },
    data: { resolvedAt: new Date(f.clock().getTime() - reopenWindowMs) },
  });
  const draft = await drafts.create(f.ana, {
    conversationId: f.conversationId,
    kind: "REOPEN",
    targetNumber: "INC-20150",
    content,
  });
  f.setNow(new Date(f.clock().getTime() + 1));
  const reopen = vi.fn();
  const confirmation = createDraftService(f.db, f.clock, (tx) => ({
    ...createTicketService(tx, f.clock),
    reopen,
  }));
  await expect(confirmation.confirm(f.ana, draft.id)).rejects.toMatchObject({
    code: "REOPEN_NOT_ALLOWED",
  });
  expect(reopen).not.toHaveBeenCalled();
  expect(await drafts.get(f.ana, draft.id)).toMatchObject({
    status: "FAILED",
    failureCode: "REOPEN_NOT_ALLOWED",
  });
  expect((await service.get(f.ana, "INC-20150"))?.status).toBe("RESOLVED");
});

test("a confirmação aceita exatamente sete dias", async () => {
  const drafts = createDraftService(f.db, f.clock);
  await f.db.ticket.update({
    where: { number: "INC-20150" },
    data: { resolvedAt: new Date(f.clock().getTime() - reopenWindowMs) },
  });
  const draft = await drafts.create(f.ana, {
    conversationId: f.conversationId,
    kind: "REOPEN",
    targetNumber: "INC-20150",
    content,
  });
  expect((await drafts.confirm(f.ana, draft.id)).ticket.status).toBe("OPEN");
});
