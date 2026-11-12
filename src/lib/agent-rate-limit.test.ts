import { expect, test } from "vitest";
import { createAgentLimiter } from "./agent-rate-limit";

test("limita sessão e IP atomicamente, isola clientes e libera após a janela", () => {
  const allow = createAgentLimiter();
  expect(allow(["session:a", "ip:1"], 2, 1000, 0)).toBe(true);
  expect(allow(["session:b", "ip:1"], 2, 1000, 0)).toBe(true);
  expect(allow(["session:c", "ip:1"], 2, 1000, 0)).toBe(false);
  expect(allow(["session:c", "ip:2"], 2, 1000, 0)).toBe(true);
  expect(allow(["session:c", "ip:2"], 2, 1000, 0)).toBe(true);
  expect(allow(["session:c", "ip:3"], 2, 1000, 0)).toBe(false);
  expect(allow(["session:c", "ip:1"], 2, 1000, 1000)).toBe(true);
});
