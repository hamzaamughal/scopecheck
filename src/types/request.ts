export type RequestDecision = "included" | "extra_work" | "needs_clarification";

export type RequestDto = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  decision: RequestDecision | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateRequestData = { request: RequestDto };

export type ListRequestsData = { requests: RequestDto[] };
export type UpdateDecisionData = { request: RequestDto };
export type DeleteRequestData = { id: string };
