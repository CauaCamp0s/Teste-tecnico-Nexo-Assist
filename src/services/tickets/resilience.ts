import { TicketUnavailableError } from "./errors";
import type { TicketService } from "./types";

type FaultHook = (
  operation: keyof TicketService,
  phase: "before" | "after",
) => void | Promise<void>;
type Options = { fault?: FaultHook; sleep?: (ms: number) => Promise<void> };

export function createTemporaryOutage(
  duration = "0",
  clock: () => number = Date.now,
): FaultHook {
  const milliseconds = Number(duration);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
    throw new Error(
      "TICKET_SERVICE_OUTAGE_MS deve ser um inteiro não negativo.",
    );
  let startedAt: number | undefined;
  return (_operation, phase) => {
    if (!milliseconds || phase !== "before") return;
    const now = clock();
    startedAt ??= now;
    if (now - startedAt < milliseconds) throw new TicketUnavailableError();
  };
}

export function withTicketResilience(
  service: TicketService,
  options: Options = {},
): TicketService {
  const sleep =
    options.sleep ??
    ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  function wrap<A extends unknown[], R>(
    operation: keyof TicketService,
    call: (...args: A) => Promise<R>,
  ) {
    return async (...args: A): Promise<R> => {
      let mayHaveCommitted = false;
      for (let attempt = 1; ; attempt++) {
        try {
          await options.fault?.(operation, "before");
          const result = await call(...args);
          if (["create", "addUpdate", "reopen", "transfer"].includes(operation))
            mayHaveCommitted = true;
          await options.fault?.(operation, "after");
          return result;
        } catch (error) {
          if (!(error instanceof TicketUnavailableError)) throw error;
          mayHaveCommitted ||= error.mayHaveCommitted;
          if (attempt === 3)
            throw new TicketUnavailableError(attempt, mayHaveCommitted);
          await sleep(attempt * 500);
        }
      }
    };
  }
  return {
    list: wrap("list", service.list),
    get: wrap("get", service.get),
    findDuplicateCandidates: wrap(
      "findDuplicateCandidates",
      service.findDuplicateCandidates,
    ),
    create: wrap("create", service.create),
    addUpdate: wrap("addUpdate", service.addUpdate),
    reopen: wrap("reopen", service.reopen),
    transfer: wrap("transfer", service.transfer),
  };
}
