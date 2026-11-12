import { redirect } from "next/navigation";
import { currentUser, homeForRole } from "@/lib/session";

export default async function HomePage() {
  const user = await currentUser();
  redirect(user ? homeForRole(user.role) : "/login");
}
