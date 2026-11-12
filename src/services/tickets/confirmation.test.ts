import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("./index", () => ({
  ticketDraftService: { confirm: mocks.confirm, cancel: mocks.cancel },
}));
import { confirmTicketDraft, cancelTicketDraft } from "./confirmation";

beforeEach(() => {
  vi.resetAllMocks();
});
test("confirma e cancela somente com identidade obtida da sessão", async () => {
  mocks.requireRole.mockResolvedValue({ id: "funcionario-da-sessao" });
  await confirmTicketDraft("draft");
  await cancelTicketDraft("draft");
  expect(mocks.requireRole).toHaveBeenCalledWith("EMPLOYEE");
  expect(mocks.confirm).toHaveBeenCalledWith("funcionario-da-sessao", "draft");
  expect(mocks.cancel).toHaveBeenCalledWith("funcionario-da-sessao", "draft");
});
test("sessão ausente ou papel recusado impede confirmação e cancelamento", async () => {
  mocks.requireRole.mockRejectedValue(new Error("Acesso negado"));
  await expect(confirmTicketDraft("draft")).rejects.toThrow("Acesso negado");
  await expect(cancelTicketDraft("draft")).rejects.toThrow("Acesso negado");
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
});
