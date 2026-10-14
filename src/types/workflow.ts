import type { RequestDecision } from "@/types/request";

export type ChangeOrderStatus = "proposed" | "accepted" | "rejected";
export type ChangeOrderDto = {
  id: string; projectId: string; requestId: string | null; number: number;
  title: string; description: string; hours: number | null; amountCents: number | null; currency: string;
  status: ChangeOrderStatus; decidedAt: string | null; createdAt: string; updatedAt: string;
};
export type ScopeVersionReason = "initial" | "edit" | "import" | "link_update" | "change_order";
export type ScopeVersionDto = { id: string; version: number; reason: ScopeVersionReason; changeOrderNumber: number | null; createdAt: string; length: number };
export type ReplyDraftDto = { id: string; requestId: string; decision: RequestDecision; tone: "friendly" | "formal"; body: string; model: string; createdAt: string; changeOrderNumber: number | null; isStale: boolean };

export type ListChangeOrdersData = { changeOrders: ChangeOrderDto[] };
export type ChangeOrderData = { changeOrder: ChangeOrderDto };
export type AcceptChangeOrderData = { changeOrder: ChangeOrderDto; project: import("@/types/project").ProjectDto };
export type ListScopeVersionsData = { versions: ScopeVersionDto[] };
export type ScopeVersionData = { version: ScopeVersionDto & { scope: string } };
export type ReplyDraftData = { requestId: string; draft: ReplyDraftDto | null };
