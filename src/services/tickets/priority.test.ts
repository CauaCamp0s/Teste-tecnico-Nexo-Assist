import { expect, test } from "vitest";
import { classifyTicketPriority } from "./priority";
import type { PriorityContext, TicketPriority } from "./types";

test.each<[PriorityContext, TicketPriority]>([
  [
    { impact: "TEAM", interruption: "stopped", sameDayCommitment: false },
    "CRITICAL",
  ],
  [
    { impact: "COMPANY", interruption: "stopped", sameDayCommitment: true },
    "CRITICAL",
  ],
  [
    { impact: "SELF", interruption: "stopped", sameDayCommitment: false },
    "HIGH",
  ],
  [
    { impact: "SELF", interruption: "degraded", sameDayCommitment: true },
    "HIGH",
  ],
  [{ impact: "TEAM", interruption: "none", sameDayCommitment: true }, "HIGH"],
  [
    { impact: "SELF", interruption: "degraded", sameDayCommitment: false },
    "MEDIUM",
  ],
  [
    { impact: "COMPANY", interruption: "degraded", sameDayCommitment: false },
    "MEDIUM",
  ],
  [{ impact: "SELF", interruption: "none", sameDayCommitment: false }, "LOW"],
])("classifica impacto e urgência de %j como %s", (context, priority) => {
  expect(classifyTicketPriority(context)).toMatchObject({
    priority,
    reason: expect.any(String),
  });
});
