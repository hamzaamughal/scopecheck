import { z } from "zod";

export const deleteAccountSchema = z.object({
  confirmEmail: z.string().trim().min(1, "Type your email address to confirm").max(320),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
