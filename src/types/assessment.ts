import type { SavedAssessment } from "@/schemas/assessment";

export type AssessRequestData = {
  requestId: string;
  assessment: SavedAssessment;
};

export type GetAssessmentData = {
  requestId: string;
  assessment: SavedAssessment | null;
};
