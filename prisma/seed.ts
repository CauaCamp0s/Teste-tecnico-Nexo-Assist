import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seed-data";

const db = new PrismaClient();

seedDatabase(db)
  .catch((error: unknown) => {
    console.error("Falha ao carregar os dados iniciais:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
