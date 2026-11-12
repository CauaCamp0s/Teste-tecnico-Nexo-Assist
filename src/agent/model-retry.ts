import { setTimeout } from "node:timers/promises";
import type { ModelRetry } from "./decisions";

function retryableStatus(error: unknown): 429 | 503 | undefined {
  const seen = new Set<unknown>();
  let candidate = error;
  while (candidate && typeof candidate === "object" && !seen.has(candidate)) {
    seen.add(candidate);
    const value = candidate as {
      statusCode?: number;
      status?: number;
      cause?: unknown;
    };
    const status = value.statusCode ?? value.status;
    if (status === 429 || status === 503) return status;
    candidate = value.cause;
  }
}

export function createModelRetry(
  abortSignal: AbortSignal,
  deadline: number,
  records: ModelRetry[],
) {
  return async function run<T>(
    stage: ModelRetry["stage"],
    generate: () => Promise<T>,
  ): Promise<T> {
    try {
      return await generate();
    } catch (error) {
      const statusCode = retryableStatus(error);
      if (
        !statusCode ||
        records.length ||
        abortSignal.aborted ||
        deadline - performance.now() <= 1_000
      )
        throw error;
      const record: ModelRetry = {
        stage,
        statusCode,
        delayMs: 1_000,
        outcome: "pending",
      };
      records.push(record);
      try {
        await setTimeout(record.delayMs, undefined, { signal: abortSignal });
        abortSignal.throwIfAborted();
        const result = await generate();
        record.outcome = "succeeded";
        return result;
      } catch (retryError) {
        record.outcome = abortSignal.aborted ? "aborted" : "failed";
        throw retryError;
      }
    }
  };
}
