import { redirect } from "next/navigation";
import { currentUser, homeForRole } from "@/lib/session";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect(homeForRole(user.role));

  const { error } = await searchParams;

  return (
    <main>
      <h1>Nexo Assist</h1>
      <p>Entre com seu e-mail corporativo para acessar o service desk de TI.</p>
      <form action={login} className="login-form">
        <label htmlFor="email">E-mail corporativo</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error === "credentials" && (
          <p role="alert">
            Informe um e-mail cadastrado e uma senha não vazia.
          </p>
        )}
        <button type="submit">Entrar</button>
      </form>
    </main>
  );
}
