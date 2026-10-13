import { apiRequest } from "@/lib/api-client";
import type { DeleteAccountInput } from "@/schemas/account";

export function deleteAccount(input: DeleteAccountInput) {
  return apiRequest<{ deleted: true }>("/api/account", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
