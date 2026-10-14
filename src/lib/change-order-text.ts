// Pure text helpers for change orders (no server imports, so they are testable offline).
import type { ChangeOrderDto } from "../types/workflow.ts";

export function formatMoney(cents: number, currency: string) {
  return `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Text appended to the scope when a change order is accepted. Dates are ISO (UTC) to stay locale-neutral.
export function changeOrderAddendum(order: Pick<ChangeOrderDto, "number" | "title" | "description" | "hours" | "amountCents" | "currency">, acceptedAt: Date) {
  const estimate = [order.hours !== null ? `${order.hours} hours` : "", order.amountCents !== null ? formatMoney(order.amountCents, order.currency) : ""].filter(Boolean).join(" · ");
  return [`[Change order #${order.number} · accepted ${acceptedAt.toISOString().slice(0, 10)}]`, order.title, order.description, estimate ? `Estimate: ${estimate}` : ""].filter(Boolean).join("\n");
}
