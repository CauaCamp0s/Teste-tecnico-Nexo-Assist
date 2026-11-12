import { requireRole } from "@/lib/session";
import { logout } from "@/app/login/actions";
import {
  getConversation,
  getOrCreateConversation,
  listConversations,
} from "@/services/conversations";
import { serializeChatMessage } from "@/services/chat";
import { ChatView } from "./chat-view";
import styles from "./chat.module.css";
import { Schibsted_Grotesk } from "next/font/google";
import { formatDate } from "@/lib/presentation";

const chatFont = Schibsted_Grotesk({ subsets: ["latin"], display: "swap" });

export default async function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string }>;
} = {}) {
  const user = await requireRole("EMPLOYEE");
  const { id } = (await searchParams) ?? {};
  const current = id ? { id } : await getOrCreateConversation(user.id);
  const conversation = await getConversation(user.id, current.id);
  const conversations = await listConversations(user.id);
  if (!conversation) throw new Error("Conversa não encontrada.");
  const initials = user.name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <div className={`${styles.shell} ${chatFont.className}`}>
      <a href="#mensagem" className={styles.skipLink}>
        Ir para a mensagem
      </a>
      <aside className={styles.sidebar} aria-label="Menu principal">
        <a
          href="/chat"
          className={styles.brand}
          aria-label="Nexo Assist — Atendimento"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 28 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M23.569 3.927l-3.374 1.687c-.623.308-.973.903-.973 1.631v6.293L8.029 4.109c-.623-.469-1.372-.553-2.03-.245L2.814 5.495c-.651.322-1.008.924-1.008 1.673v15.218c0 1.477 1.526 2.289 2.716 1.785l3.073-1.617c.693-.322 1.057-.952 1.057-1.722v-7.7l11.732 10.591c.602.546 1.421.679 2.086.364l2.786-1.505c.602-.315.938-.931.938-1.68V5.614c0-1.463-1.505-2.275-2.625-1.687z"
              transform="translate(0 -3)"
            />
          </svg>
          <span>Nexo Assist</span>
        </a>
        <nav>
          <a href="/chat" aria-current="page" className={styles.navActive}>
            <span aria-hidden="true">◷</span> Atendimento
          </a>
        </nav>
        <nav aria-label="Conversas anteriores">
          {conversations.map((item) => (
            <a key={item.id} href={`/chat?id=${item.id}`}>
              {formatDate(item.createdAt)} ·{" "}
              {item.status === "AGENT"
                ? "Assistente"
                : item.status === "CLOSED"
                  ? "Encerrada"
                  : "Atendimento humano"}
            </a>
          ))}
        </nav>
        <div className={styles.account}>
          <span className={styles.avatar} aria-hidden="true">
            {initials}
          </span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <form action={logout}>
          <button className={styles.logout} type="submit">
            <span aria-hidden="true">↪</span> Sair
          </button>
        </form>
      </aside>
      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <span>Service desk de TI</span>
            <span aria-hidden="true">›</span>
            <h1>Atendimento</h1>
          </div>
          <span className={styles.assistantStatus}>
            <span aria-hidden="true" />
            {conversation.status === "AGENT"
              ? "Assistente virtual"
              : "Atendimento pausado"}
          </span>
        </header>
        <ChatView
          key={conversation.id}
          conversationId={conversation.id}
          status={conversation.status}
          initialMessages={conversation.messages.map(serializeChatMessage)}
          firstName={user.name.split(" ")[0]}
        />
      </main>
    </div>
  );
}
