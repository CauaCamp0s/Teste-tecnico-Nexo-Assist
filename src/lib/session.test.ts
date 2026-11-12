import { beforeEach, expect, test, vi } from "vitest";
import { createSession, getSessionUser, revokeSession } from "@/services/auth";
import { sessionCookieOptions } from "./session";
import ChatPage from "@/app/chat/page";
import ConsolePage from "@/app/console/page";
import { login, logout } from "@/app/login/actions";

const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/services/auth", () => ({
  createSession: vi.fn(),
  getSessionUser: vi.fn(),
  revokeSession: vi.fn(),
}));

const employee = {
  id: "employee",
  email: "ana.souza@nexo.com.br",
  name: "Ana Souza",
  role: "EMPLOYEE" as const,
  createdAt: new Date(),
};
const analyst = { ...employee, id: "analyst", role: "ANALYST" as const };

beforeEach(() => {
  cookieStore.get.mockReturnValue({ value: "existing-token" });
  vi.mocked(getSessionUser).mockResolvedValue(null);
});

test.each([ChatPage, ConsolePage])(
  "protege a página no servidor sem sessão válida",
  async (page) => {
    await expect(page()).rejects.toThrow("redirect:/login");
  },
);

test("impede funcionário de acessar o console", async () => {
  vi.mocked(getSessionUser).mockResolvedValue(employee);
  await expect(ConsolePage()).rejects.toThrow("redirect:/chat");
});

test("impede analista de acessar a página de funcionário", async () => {
  vi.mocked(getSessionUser).mockResolvedValue(analyst);
  await expect(ChatPage()).rejects.toThrow("redirect:/console");
});

test("libera cada página apenas para seu papel", async () => {
  vi.mocked(getSessionUser).mockResolvedValue(employee);
  await expect(ChatPage()).resolves.toBeDefined();
  vi.mocked(getSessionUser).mockResolvedValue(analyst);
  await expect(ConsolePage()).resolves.toBeDefined();
});

test.each([
  [employee, "/chat"],
  [analyst, "/console"],
] as const)(
  "o login redireciona pelo papel para %s",
  async (user, destination) => {
    const expiresAt = new Date(Date.now() + 1000);
    vi.mocked(createSession).mockResolvedValue({
      user,
      token: "new-token",
      expiresAt,
    });
    const form = new FormData();
    form.set("email", user.email);
    form.set("password", "senha");
    form.set("role", user.role === "EMPLOYEE" ? "ANALYST" : "EMPLOYEE");
    await expect(login(form)).rejects.toThrow(`redirect:${destination}`);
    expect(revokeSession).toHaveBeenCalledWith("existing-token");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "nexo_session",
      "new-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      }),
    );
  },
);

test("não grava cookie quando as credenciais são recusadas", async () => {
  vi.mocked(createSession).mockResolvedValue(null);
  const form = new FormData();
  form.set("email", "desconhecido@nexo.com.br");
  form.set("password", "senha");
  await expect(login(form)).rejects.toThrow(
    "redirect:/login?error=credentials",
  );
  expect(cookieStore.set).not.toHaveBeenCalled();
});

test("logout revoga o token e remove o cookie", async () => {
  await expect(logout()).rejects.toThrow("redirect:/login");
  expect(revokeSession).toHaveBeenCalledWith("existing-token");
  expect(cookieStore.delete).toHaveBeenCalledWith("nexo_session");
});

test("cookie usa secure em produção e permite HTTP local", () => {
  try {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions(new Date()).secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieOptions(new Date()).secure).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
