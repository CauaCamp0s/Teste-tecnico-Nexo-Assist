import { z } from "zod";

export const proposalSchema = z.object({
  title: z.string().trim().max(200).nullable(),
  description: z.string().trim().max(10000).nullable(),
  type: z.enum(["INC", "REQ"]).nullable(),
  category: z
    .enum(["ACCESS", "NETWORK_VPN", "HARDWARE", "SOFTWARE", "EMAIL", "OTHER"])
    .nullable(),
  impact: z.enum(["SELF", "TEAM", "COMPANY"]).nullable(),
  interruption: z.enum(["stopped", "degraded", "none"]).nullable(),
  sameDayCommitment: z.boolean().nullable(),
  duplicate: z
    .object({
      relation: z.enum(["same", "different", "uncertain"]),
      number: z.string().nullable(),
    })
    .nullable(),
});
export type TicketProposal = z.infer<typeof proposalSchema>;
