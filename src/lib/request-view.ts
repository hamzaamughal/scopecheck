import type { Decision, Request } from "@/lib/demo-data";
import type { RequestDecision, RequestDto } from "@/types/request";

export const decisionLabels: Record<RequestDecision, Decision> = {
  included: "Included",
  extra_work: "Extra work",
  needs_clarification: "Needs clarification",
};

export function toRequestView(request: RequestDto): Request {
  return {
    id: request.id,
    title: request.title,
    description: request.description,
    date: new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(request.createdAt)),
    decision: request.decision ? decisionLabels[request.decision] : undefined,
    note: request.decisionNote ?? "",
  };
}
