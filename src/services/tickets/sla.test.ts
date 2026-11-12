import { expect, test, vi } from "vitest";
import { calculateTicketDueAt, getTicketSla } from "./sla";
import type { TicketPriority, TicketSlaSource } from "./types";

test.each<[TicketPriority, string, string]>([
  ["CRITICAL", "2026-11-13T23:30:00-03:00", "2026-11-14T00:30:00-03:00"],
  ["CRITICAL", "2026-11-14T10:00:00-03:00", "2026-11-14T11:00:00-03:00"],
  ["HIGH", "2026-11-09T10:00:00-03:00", "2026-11-09T14:00:00-03:00"],
  ["HIGH", "2026-11-09T16:00:00-03:00", "2026-11-10T10:00:00-03:00"],
  ["HIGH", "2026-11-13T17:00:00-03:00", "2026-11-16T11:00:00-03:00"],
  ["HIGH", "2026-11-14T12:00:00-03:00", "2026-11-16T12:00:00-03:00"],
  ["HIGH", "2026-11-15T23:00:00-03:00", "2026-11-16T12:00:00-03:00"],
  ["HIGH", "2026-11-09T07:00:00-03:00", "2026-11-09T12:00:00-03:00"],
  ["HIGH", "2026-11-09T18:00:00-03:00", "2026-11-10T12:00:00-03:00"],
  ["HIGH", "2026-11-09T14:00:00-03:00", "2026-11-09T18:00:00-03:00"],
  ["HIGH", "2026-11-09T17:30:15.250-03:00", "2026-11-10T11:30:15.250-03:00"],
  ["MEDIUM", "2026-11-09T10:00:00-03:00", "2026-11-12T10:00:00-03:00"],
  ["MEDIUM", "2026-11-09T08:00:00-03:00", "2026-11-11T18:00:00-03:00"],
  ["MEDIUM", "2026-11-13T16:00:00-03:00", "2026-11-18T16:00:00-03:00"],
  ["LOW", "2026-11-09T10:00:00-03:00", "2026-11-16T10:00:00-03:00"],
  ["LOW", "2026-11-13T17:00:00-03:00", "2026-11-20T17:00:00-03:00"],
  ["HIGH", "2026-12-25T09:00:00-03:00", "2026-12-25T13:00:00-03:00"],
  ["HIGH", "2018-11-02T17:00:00-03:00", "2018-11-05T11:00:00-02:00"],
])("prazo %s de %s chega a %s", (priority, from, expected) => {
  expect(calculateTicketDueAt(priority, new Date(from))).toEqual(
    new Date(expected),
  );
});

const ticket: TicketSlaSource = {
  priority: "HIGH",
  status: "OPEN",
  createdAt: new Date("2026-11-09T10:00:00-03:00"),
  lastUpdatedAt: null,
};

test("vence somente depois do prazo, não no instante exato", () => {
  expect(
    getTicketSla(ticket, new Date("2026-11-09T14:00:00-03:00")).isOverdue,
  ).toBe(false);
  expect(
    getTicketSla(ticket, new Date("2026-11-09T14:00:00.001-03:00")).isOverdue,
  ).toBe(true);
});

test("primeira resposta usa abertura e cada atualização reinicia o mesmo prazo", () => {
  const now = new Date("2026-11-10T09:00:00-03:00");
  expect(getTicketSla(ticket, now).isOverdue).toBe(true);
  expect(
    getTicketSla(
      { ...ticket, lastUpdatedAt: new Date("2026-11-09T17:00:00-03:00") },
      now,
    ),
  ).toEqual({ dueAt: new Date("2026-11-10T11:00:00-03:00"), isOverdue: false });
  expect(
    getTicketSla(
      { ...ticket, lastUpdatedAt: new Date("2026-11-10T10:00:00-03:00") },
      now,
    ).dueAt,
  ).toEqual(new Date("2026-11-10T14:00:00-03:00"));
});

test.each(["OPEN", "WAITING_FOR_ANALYST", "IN_PROGRESS", "APPROVED"] as const)(
  "status %s continua sujeito ao prazo",
  (status) => {
    expect(
      getTicketSla({ ...ticket, status }, new Date("2026-11-10T10:00:00-03:00"))
        .isOverdue,
    ).toBe(true);
  },
);

test.each(["RESOLVED", "CLOSED"] as const)(
  "status %s não possui prazo pendente",
  (status) => {
    expect(
      getTicketSla({ ...ticket, status }, new Date("2026-12-01T10:00:00Z")),
    ).toEqual({ dueAt: null, isOverdue: false });
  },
);

test("usa o fuso de São Paulo independentemente do fuso do processo", () => {
  vi.stubEnv("TZ", "Asia/Tokyo");
  try {
    expect(
      calculateTicketDueAt("HIGH", new Date("2026-11-14T01:00:00Z")),
    ).toEqual(new Date("2026-11-16T15:00:00Z"));
  } finally {
    vi.unstubAllEnvs();
  }
});

test("rejeita datas inválidas e não altera o instante de entrada", () => {
  const from = new Date("2026-11-13T17:00:00-03:00");
  calculateTicketDueAt("HIGH", from);
  expect(from.toISOString()).toBe("2026-11-13T20:00:00.000Z");
  expect(() => calculateTicketDueAt("HIGH", new Date("inválida"))).toThrow(
    "Data inválida",
  );
});
