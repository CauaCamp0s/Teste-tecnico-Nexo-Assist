import { PrismaClient, UserRole } from "@prisma/client";
import { seedTickets } from "./ticket-seed";

const users = [
  {
    email: "ana.souza@nexo.com.br",
    name: "Ana Souza",
    role: UserRole.EMPLOYEE,
  },
  {
    email: "bruno.tavares@nexo.com.br",
    name: "Bruno Tavares",
    role: UserRole.EMPLOYEE,
  },
  {
    email: "carla.mendes@nexo.com.br",
    name: "Carla Mendes",
    role: UserRole.EMPLOYEE,
  },
  {
    email: "rafael.lima@nexo.com.br",
    name: "Rafael Lima",
    role: UserRole.ANALYST,
  },
];

const articles = [
  {
    slug: "vpn-erro-809",
    title: "VPN com erro 809",
    content:
      "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.",
  },
  {
    slug: "horario-service-desk",
    title: "Horário do service desk",
    content:
      "O service desk atende de segunda a sexta, das 8h às 18h, no horário de Brasília. Chamados críticos têm plantão 24 horas.",
  },
  {
    slug: "solicitar-acesso",
    title: "Como solicitar acesso a um sistema",
    content:
      "Informe o nome do sistema, o acesso necessário e a finalidade do uso. A solicitação deve ser registrada como chamado. Não envie senhas pelo chat.",
  },
  {
    slug: "instalar-software",
    title: "Instalação de software corporativo",
    content:
      "Procure o aplicativo no portal de softwares da Nexo. Se estiver disponível, siga as instruções de instalação. Caso não esteja ou a instalação falhe, informe o nome do aplicativo e a mensagem de erro ao service desk.",
  },
  {
    slug: "notebook-lento",
    title: "Notebook lento",
    content:
      "Salve seu trabalho, feche os aplicativos que não estão em uso e reinicie o notebook. Se a lentidão continuar, informe quando começou, quais programas são afetados e se existe uma alternativa para trabalhar.",
  },
  {
    slug: "outlook-sem-sincronizar",
    title: "Outlook não sincroniza mensagens",
    content:
      "Verifique a conexão com a internet e reinicie o Outlook. Tente acessar o e-mail pelo navegador como alternativa. Se o problema persistir, informe se o acesso pelo navegador funciona e qual erro aparece no aplicativo.",
  },
];

export async function seedDatabase(db: PrismaClient, now = new Date()) {
  await db.$transaction([
    ...users.map((user) =>
      db.user.upsert({
        where: { email: user.email },
        create: user,
        update: {},
      }),
    ),
    ...articles.map((article) =>
      db.article.upsert({
        where: { slug: article.slug },
        create: article,
        update: {},
      }),
    ),
  ]);
  await seedTickets(db, now);
}
