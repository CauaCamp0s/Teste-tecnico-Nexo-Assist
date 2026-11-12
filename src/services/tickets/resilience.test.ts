import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createTicketService } from "./service";
import { createDraftService } from "./drafts";
import { createTemporaryOutage, withTicketResilience } from "./resilience";
import { TicketUnavailableError } from "./errors";
import {
  content,
  createTicketFixture,
  type TicketFixture,
} from "./test-support";

let f: TicketFixture;
beforeAll(async () => {
  f = await createTicketFixture();
}, 30_000);
beforeEach(async () => {
  await f.reset();
});
afterAll(async () => {
  await f?.close();
});
const sleep = vi.fn(async (ms: number) =>
  f.setNow(new Date(f.clock().getTime() + ms)),
);
beforeEach(() => sleep.mockClear());

test("transferência persiste resumo, proprietário, prazo e idempotência", async () => {
  const service = createTicketService(f.db, f.clock);
  const first = await service.transfer(
    f.ana,
    "INC-20312",
    " Diagnóstico realizado ",
    "transfer",
  );
  expect(first).toMatchObject({
    status: "WAITING_FOR_ANALYST",
    transferSummary: "Diagnóstico realizado",
    lastUpdatedAt: f.clock(),
  });
  f.setNow(new Date(f.clock().getTime() + 60_000));
  expect(
    await service.transfer(
      f.ana,
      "INC-20312",
      "Diagnóstico realizado",
      "transfer",
    ),
  ).toMatchObject({ lastUpdatedAt: first.lastUpdatedAt });
  await expect(
    service.transfer(f.ana, "INC-20312", "Outro", "transfer"),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    service.transfer(f.bruno, "INC-20312", "Resumo", "other"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service.transfer(f.ana, "INC-20150", "Resumo", "resolved"),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  await f.db.ticket.update({
    where: { number: "INC-20312" },
    data: { status: "CLOSED" },
  });
  await expect(
    service.transfer(f.ana, "INC-20312", "Resumo", "closed"),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect(await f.db.ticketOperation.count()).toBe(1);
});

test.each(["0", "1000", "3000"])(
  "janela de indisponibilidade %s usa relógio controlado",
  async (duration) => {
    const fault = createTemporaryOutage(duration, () => f.clock().getTime());
    const service = withTicketResilience(createTicketService(f.db, f.clock), {
      fault,
      sleep,
    });
    if (duration === "3000") {
      await expect(
        service.create(f.ana, content, "create"),
      ).rejects.toMatchObject({
        code: "UNAVAILABLE",
        attempts: 3,
        mayHaveCommitted: false,
      });
      expect(await f.db.ticketOperation.count()).toBe(0);
      f.setNow(new Date(f.clock().getTime() + 1500));
    }
    expect(await service.list(f.ana)).not.toHaveLength(0);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(
      duration === "0" ? [] : [500, 1000],
    );
    await service.get(f.ana, "INC-20312");
    expect(sleep).toHaveBeenCalledTimes(duration === "0" ? 0 : 2);
  },
);

test("validação não é repetida e configuração inválida é rejeitada", async () => {
  const fault = vi.fn();
  const service = withTicketResilience(createTicketService(f.db, f.clock), {
    fault,
    sleep,
  });
  await expect(
    service.transfer(f.ana, "INC-20312", " ", "key"),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(fault).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
  for (const value of ["-1", "NaN", "1.5"])
    expect(() => createTemporaryOutage(value)).toThrow("inteiro");
});

test.each(["create", "addUpdate", "reopen", "transfer"] as const)(
  "resposta perdida de %s não duplica escrita",
  async (operation) => {
    let failures = 0;
    const service = withTicketResilience(createTicketService(f.db, f.clock), {
      sleep,
      fault: (_op, phase) => {
        if (phase === "after" && failures++ === 0)
          throw new TicketUnavailableError();
      },
    });
    if (operation === "create") await service.create(f.ana, content, "key");
    else if (operation === "transfer")
      await service.transfer(f.ana, "INC-20312", "Resumo", "key");
    else
      await service[operation](
        f.ana,
        operation === "reopen" ? "INC-20150" : "INC-20312",
        content,
        "key",
      );
    expect(await f.db.ticketOperation.count()).toBe(1);
    expect(await f.db.ticket.count()).toBe(operation === "create" ? 10 : 9);
    expect(sleep.mock.calls).toEqual([[500]]);
    if (operation === "addUpdate")
      expect(
        (await service.get(f.ana, "INC-20312"))?.description.split(
          content.description,
        ),
      ).toHaveLength(2);
  },
);

test("esgotamento após escrita informa resultado potencialmente efetivado", async () => {
  const service = withTicketResilience(createTicketService(f.db, f.clock), {
    sleep,
    fault: (_op, phase) => {
      if (phase === "after") throw new TicketUnavailableError();
    },
  });
  await expect(service.create(f.ana, content, "key")).rejects.toMatchObject({
    attempts: 3,
    mayHaveCommitted: true,
  });
  expect(await f.db.ticketOperation.count()).toBe(1);
});

test.each([false, true])(
  "confirmação mantém atomicidade com falha persistente=%s",
  async (persistent) => {
    let failures = 0;
    const drafts = createDraftService(f.db, f.clock, (tx) =>
      withTicketResilience(createTicketService(tx, f.clock), {
        sleep,
        fault: (_op, phase) => {
          if (phase === "after" && (persistent || failures++ === 0))
            throw new TicketUnavailableError();
        },
      }),
    );
    const draft = await drafts.create(f.ana, {
      conversationId: f.conversationId,
      kind: "CREATE",
      content,
    });
    if (persistent) {
      await expect(drafts.confirm(f.ana, draft.id)).rejects.toBeInstanceOf(
        TicketUnavailableError,
      );
      expect((await drafts.get(f.ana, draft.id)).status).toBe("FAILED");
    } else
      expect((await drafts.confirm(f.ana, draft.id)).draft.status).toBe(
        "CONFIRMED",
      );
    expect(await f.db.ticketOperation.count()).toBe(persistent ? 0 : 1);
    expect(await f.db.ticket.count()).toBe(persistent ? 9 : 10);
  },
);
