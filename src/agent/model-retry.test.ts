import { expect, test, vi } from "vitest";
import type { ModelRetry } from "./decisions";
import { createModelRetry } from "./model-retry";

test("não inicia retry sem orçamento para a espera", async () => {
  const records: ModelRetry[] = [];
  const run = createModelRetry(
    new AbortController().signal,
    performance.now() + 500,
    records,
  );
  const generate = vi.fn().mockRejectedValue({ statusCode: 503 });
  await expect(run("answer", generate)).rejects.toEqual({ statusCode: 503 });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(records).toEqual([]);
});

test("cancela a espera quando o orçamento expira", async () => {
  const records: ModelRetry[] = [];
  const run = createModelRetry(
    AbortSignal.timeout(25),
    performance.now() + 20_000,
    records,
  );
  const generate = vi.fn().mockRejectedValue({ cause: { statusCode: 429 } });
  await expect(run("initial", generate)).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(records[0].outcome).toBe("aborted");
});
