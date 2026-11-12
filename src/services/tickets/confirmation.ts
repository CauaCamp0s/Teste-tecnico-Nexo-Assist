import { requireRole } from "@/lib/session";
import { ticketDraftService } from "./index";

export async function confirmTicketDraft(draftId: string) {
  const employee = await requireRole("EMPLOYEE");
  return ticketDraftService.confirm(employee.id, draftId);
}

export async function cancelTicketDraft(draftId: string) {
  const employee = await requireRole("EMPLOYEE");
  return ticketDraftService.cancel(employee.id, draftId);
}
