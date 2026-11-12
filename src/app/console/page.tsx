import { requireRole } from "@/lib/session";
import { ConsoleView } from "./console-view";
import { Schibsted_Grotesk } from "next/font/google";

const font = Schibsted_Grotesk({ subsets: ["latin"], display: "swap" });

export default async function ConsolePage() {
  const user = await requireRole("ANALYST");

  return (
    <div className={font.className}>
      <ConsoleView analystId={user.id} analystName={user.name} />
    </div>
  );
}
