import type { Prisma, PrismaClient } from "@prisma/client";

type SeedTicket = Omit<Prisma.TicketCreateManyInput, "employeeId"> & {
  employeeEmail: string;
};

export async function seedTickets(db: PrismaClient, now: Date) {
  const dayMs = 24 * 60 * 60 * 1_000;
  const ago = (days: number) => new Date(now.getTime() - days * dayMs);
  const ana = "ana.souza@nexo.com.br";
  const tickets: SeedTicket[] = [
    {
      number: "INC-20311",
      employeeEmail: ana,
      type: "INC",
      category: "HARDWARE",
      priority: "MEDIUM",
      status: "WAITING_FOR_ANALYST",
      impact: "SELF",
      title: "Notebook lento após atualização do Windows",
      description:
        "Lentidão após a atualização do Windows. Reiniciar não resolveu; o funcionário consegue trabalhar com limitações.",
      createdAt: ago(8),
      lastUpdatedAt: ago(6),
    },
    {
      number: "REQ-10442",
      employeeEmail: ana,
      type: "REQ",
      category: "HARDWARE",
      priority: "LOW",
      status: "APPROVED",
      impact: "SELF",
      title: "Segundo monitor para home office",
      description:
        "Solicitação de segundo monitor aprovada, aguardando disponibilização do equipamento. Sem urgência.",
      createdAt: ago(9),
      lastUpdatedAt: ago(7),
    },
    {
      number: "INC-20150",
      employeeEmail: ana,
      type: "INC",
      category: "ACCESS",
      priority: "MEDIUM",
      status: "RESOLVED",
      impact: "SELF",
      title: "Senha do SAP bloqueada",
      description:
        "Acesso ao SAP desbloqueado e validado pela funcionária. Havia alternativa temporária de trabalho.",
      createdAt: ago(10),
      lastUpdatedAt: ago(4),
      resolvedAt: ago(4),
    },
    {
      number: "INC-20312",
      employeeEmail: ana,
      type: "INC",
      category: "NETWORK_VPN",
      priority: "HIGH",
      status: "OPEN",
      impact: "SELF",
      title: "VPN não conecta — erro 809",
      description:
        "VPN sem conectar no Windows 11, impedindo acesso aos sistemas internos. Aguarda uma nova atualização do suporte.",
      createdAt: ago(8),
      lastUpdatedAt: ago(4),
    },
    {
      number: "INC-20313",
      employeeEmail: ana,
      type: "INC",
      category: "HARDWARE",
      priority: "MEDIUM",
      status: "RESOLVED",
      impact: "SELF",
      title: "Impressora não imprime",
      description:
        "Fila de impressão corrigida e impressão validada. Outra impressora foi usada durante o atendimento.",
      createdAt: ago(5),
      lastUpdatedAt: ago(2),
      resolvedAt: ago(2),
    },
    {
      number: "INC-20314",
      employeeEmail: ana,
      type: "INC",
      category: "SOFTWARE",
      priority: "MEDIUM",
      status: "RESOLVED",
      impact: "SELF",
      title: "Planilha fecha ao exportar relatório",
      description:
        "Aplicativo atualizado e exportação normalizada. A exportação pelo navegador serviu de alternativa.",
      createdAt: ago(16),
      lastUpdatedAt: ago(12),
      resolvedAt: ago(12),
    },
    {
      number: "REQ-10443",
      employeeEmail: ana,
      type: "REQ",
      category: "SOFTWARE",
      priority: "LOW",
      status: "OPEN",
      impact: "SELF",
      title: "Instalação de editor de diagramas",
      description:
        "Pedido sem urgência para instalar o editor de diagramas aprovado pela empresa.",
      createdAt: new Date(now.getTime() - 30 * 60 * 1_000),
    },
    {
      number: "INC-20315",
      employeeEmail: "bruno.tavares@nexo.com.br",
      type: "INC",
      category: "EMAIL",
      priority: "CRITICAL",
      status: "OPEN",
      impact: "TEAM",
      title: "E-mail indisponível para a equipe comercial",
      description:
        "Toda a equipe comercial está parada, sem acesso ao e-mail. Bruno é o solicitante responsável pelo chamado.",
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
    },
    {
      number: "REQ-10444",
      employeeEmail: "carla.mendes@nexo.com.br",
      type: "REQ",
      category: "HARDWARE",
      priority: "LOW",
      status: "IN_PROGRESS",
      impact: "SELF",
      title: "Solicitação de headset",
      description:
        "Separação de headset para reuniões remotas, sem urgência. O equipamento atual pode ser utilizado até a entrega.",
      createdAt: ago(3),
      lastUpdatedAt: ago(1),
    },
  ];
  const employees = await db.user.findMany({
    where: {
      email: {
        in: [...new Set(tickets.map(({ employeeEmail }) => employeeEmail))],
      },
    },
    select: { id: true, email: true },
  });
  const ids = new Map(employees.map(({ id, email }) => [email, id]));
  await db.$transaction(
    tickets.map(({ employeeEmail, ...ticket }) => {
      const employeeId = ids.get(employeeEmail);
      if (!employeeId)
        throw new Error("Funcionário do seed de chamados não encontrado.");
      return db.ticket.upsert({
        where: { number: ticket.number },
        create: { ...ticket, employeeId },
        update: {},
      });
    }),
  );
}
