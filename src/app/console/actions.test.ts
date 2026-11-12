import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  act: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/services/tickets", () => ({ ticketService: {} }));
vi.mock("@/services/analyst", () => ({ createAnalystService: () => mocks }));
import {
  getAnalystConversation,
  listAnalystConversations,
  manageAnalystConversation,
} from "./actions";
beforeEach(() => {
  vi.resetAllMocks();
});
test("ações obtêm analista da sessão, nunca do cliente", async () => {
  mocks.requireRole.mockResolvedValue({ id: "analista-sessao" });
  await listAnalystConversations("WAITING_FOR_ANALYST");
  await getAnalystConversation("conversa");
  await manageAnalystConversation("conversa", "reply", "Oi");
  expect(mocks.requireRole).toHaveBeenCalledWith("ANALYST");
  expect(mocks.list).toHaveBeenCalledWith(
    "analista-sessao",
    "WAITING_FOR_ANALYST",
  );
  expect(mocks.detail).toHaveBeenCalledWith("analista-sessao", "conversa");
  expect(mocks.act).toHaveBeenCalledWith(
    "analista-sessao",
    "conversa",
    "reply",
    "Oi",
  );
});
test("funcionário ou sessão ausente não chega ao serviço do analista", async () => {
  mocks.requireRole.mockRejectedValue(new Error("Papel recusado"));
  await expect(listAnalystConversations()).rejects.toThrow();
  await expect(getAnalystConversation("conversa")).rejects.toThrow();
  await expect(
    manageAnalystConversation("conversa", "assume"),
  ).rejects.toThrow();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(mocks.act).not.toHaveBeenCalled();
});
