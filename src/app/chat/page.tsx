import { requireRole } from "@/lib/session";
import { logout } from "@/app/login/actions";

export default async function ChatPage() {
  const user = await requireRole("EMPLOYEE");

  return (
    <main>
      <h1>Atendimento</h1>
      <p>Olá, {user.name}.</p>
      <p>O chat estará disponível em uma próxima etapa.</p>
      <form action={logout}>
        <button type="submit">Sair</button>
      </form>
    </main>
  );
}
