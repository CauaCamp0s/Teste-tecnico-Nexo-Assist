import { redirect } from "next/navigation";
import { currentUser, homeForRole } from "@/lib/session";
import { login } from "./actions";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import { BrandMark } from "@/app/brand-mark";
import { LoginButton } from "./submit-button";
import styles from "./login.module.css";

const uiFont = Schibsted_Grotesk({ subsets: ["latin"], display: "swap" });
const displayFont = Newsreader({ subsets: ["latin"], display: "swap" });

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect(homeForRole(user.role));

  const { error } = await searchParams;

  return (
    <main className={`${styles.shell} ${uiFont.className}`}>
      <section className={styles.showcase} aria-label="Sobre o Nexo Assist">
        <a href="/login" className={styles.brand}>
          <BrandMark />
          Nexo Assist
        </a>
        <div className={styles.introduction}>
          <p className={styles.eyebrow}>Service desk de TI da Nexo</p>
          <h1 className={displayFont.className}>
            Seu problema de TI, resolvido em uma conversa.
          </h1>
          <p>
            Descreva o que está acontecendo. O assistente consulta seus
            chamados, busca na central de ajuda e chama um analista quando
            precisa.
          </p>
        </div>
        <div
          className={styles.preview}
          aria-label="Exemplo ilustrativo de atendimento"
        >
          <p className={styles.previewLabel}>EXEMPLO DE ATENDIMENTO</p>
          <div className={styles.exampleEmployee}>
            Meu notebook não conecta na VPN. Erro 809.
          </div>
          <div className={styles.exampleAgent}>
            <strong>Nexo Assist</strong>
            <span>Consulta a central de ajuda e seus chamados</span>
            <p>
              Vou verificar o problema. Se precisar de um chamado, você confere
              os dados antes de confirmar.
            </p>
            <div className={styles.exampleCard}>
              Rede e VPN <span>Rascunho para sua confirmação</span>
            </div>
          </div>
        </div>
        <footer>
          Orientação, chamados e atendimento humano no mesmo lugar.
        </footer>
      </section>
      <section className={styles.signIn} aria-label="Entrar no service desk">
        <p className={styles.help}>
          Ambiente de demonstração · contas no README
        </p>
        <div className={styles.formColumn}>
          <h2 className={displayFont.className}>Entrar</h2>
          <p>
            Use seu e-mail corporativo e uma senha para acessar o atendimento.
          </p>
          <form action={login} className={styles.form}>
            <label htmlFor="email">E-mail corporativo</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="ana.souza@nexo.com.br"
            />
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="Digite uma senha"
            />
            {error === "credentials" && (
              <p className={styles.error} role="alert">
                Informe um e-mail cadastrado e uma senha não vazia.
              </p>
            )}
            <LoginButton />
          </form>
          <p className={styles.demo}>
            Nesta demonstração, use uma conta cadastrada e qualquer senha não
            vazia. Funcionários e analistas entram por aqui.
          </p>
        </div>
        <footer>© 2026 Nexo · Service desk de TI</footer>
      </section>
    </main>
  );
}
