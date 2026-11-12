import { requireRole } from "@/lib/session";
import { logout } from "@/app/login/actions";

export default async function ConsolePage() {
  const user = await requireRole("ANALYST");

  return (
    <main>
      <h1>Console do analista</h1>
      <p>Olá, {user.name}.</p>
      <p>A fila de atendimento estará disponível em uma próxima etapa.</p>
      <form action={logout}>
        <button type="submit">Sair</button>
      </form>
    </main>
  );
}
