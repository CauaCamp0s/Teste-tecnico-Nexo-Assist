import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  saveChatMessage: vi.fn(),
  generateChatReply: vi.fn(),
  allowAgentRequest: vi.fn(),
}));
vi.mock("@/lib/agent-rate-limit", () => ({
  allowAgentRequest: mocks.allowAgentRequest,
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/services/chat", () => ({
  saveChatMessage: mocks.saveChatMessage,
  generateChatReply: mocks.generateChatReply,
}));
import { requestReply, sendMessage } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.allowAgentRequest.mockResolvedValue(true);
  mocks.requireRole.mockResolvedValue({ id: "funcionario-da-sessao" });
});

test("limite bloqueia o modelo e preserva mensagem para nova tentativa", async () => {
  mocks.allowAgentRequest.mockResolvedValue(false);
  expect((await requestReply("conversa", "mensagem")).error).toContain(
    "Muitas solicitações",
  );
  expect(mocks.generateChatReply).not.toHaveBeenCalled();
});

test("deriva o funcionário da sessão tanto no envio quanto na geração", async () => {
  mocks.saveChatMessage.mockResolvedValue({ id: "mensagem" });
  mocks.generateChatReply.mockResolvedValue({ id: "resposta" });
  await sendMessage("conversa", "Olá");
  await requestReply("conversa", "mensagem");
  expect(mocks.requireRole).toHaveBeenCalledWith("EMPLOYEE");
  expect(mocks.saveChatMessage).toHaveBeenCalledWith(
    "funcionario-da-sessao",
    "conversa",
    "Olá",
  );
  expect(mocks.generateChatReply).toHaveBeenCalledWith(
    "funcionario-da-sessao",
    "conversa",
    "mensagem",
  );
});

test("falha de autenticação não é capturada nem permite acesso ao serviço", async () => {
  mocks.requireRole.mockRejectedValue(new Error("Redirecionar ao login"));
  await expect(sendMessage("conversa", "Olá")).rejects.toThrow("Redirecionar");
  await expect(requestReply("conversa", "mensagem")).rejects.toThrow(
    "Redirecionar",
  );
  expect(mocks.saveChatMessage).not.toHaveBeenCalled();
  expect(mocks.generateChatReply).not.toHaveBeenCalled();
});

test("falhas internas retornam erro legível sem expor detalhes do provedor", async () => {
  mocks.generateChatReply.mockRejectedValue(
    new Error("Detalhe privado do provedor"),
  );
  const result = await requestReply("conversa", "mensagem");
  expect(result.error).toContain("Sua mensagem está salva");
  expect(JSON.stringify(result)).not.toContain("Detalhe privado");
});
