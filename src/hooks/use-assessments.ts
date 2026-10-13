"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedAssessment } from "@/schemas/assessment";
import { generateAssessment, loadAssessment } from "@/services/assessments";
import { ApiClientError } from "@/lib/api-client";

export type AssessmentState = {
  assessment?: SavedAssessment;
  loading: boolean;
  generating?: boolean;
  error?: string;
  retryLoad?: boolean;
};

export function useAssessments(onUsageChanged: () => Promise<void>) {
  const [states, setStates] = useState<Record<string, AssessmentState>>({});
  const pending = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controllers = pending.current;
    return () => { controllers.forEach(controller => controller.abort()); controllers.clear(); };
  }, []);

  const run = useCallback(async (projectId: string, requestId: string, generate: boolean) => {
    const key = `${projectId}/${requestId}`;
    if (pending.current.has(key)) return;
    const controller = new AbortController();
    pending.current.set(key, controller);
    setStates(previous => ({ ...previous, [key]: { ...previous[key], loading: true, generating: generate, error: undefined, retryLoad: false } }));
    try {
      const assessment = await (generate ? generateAssessment : loadAssessment)(projectId, requestId, controller.signal);
      if (!controller.signal.aborted) setStates(previous => ({ ...previous, [key]: { assessment: assessment ?? undefined, loading: false } }));
    } catch (error) {
      if (!controller.signal.aborted) setStates(previous => ({
        ...previous,
        [key]: {
          ...previous[key], loading: false, generating: false,
          error: error instanceof Error ? error.message : "Could not load the assessment. Please try again.",
          retryLoad: !generate || (error instanceof ApiClientError && ["ASSESSMENT_SAVE_FAILED", "NETWORK_ERROR", "INVALID_RESPONSE"].includes(error.code)),
        },
      }));
    } finally {
      if (pending.current.get(key) === controller) pending.current.delete(key);
      if (generate && !controller.signal.aborted) void onUsageChanged();
    }
  }, [onUsageChanged]);

  const load = useCallback((projectId: string, requestId: string) => run(projectId, requestId, false), [run]);
  const generate = useCallback((projectId: string, requestId: string) => run(projectId, requestId, true), [run]);
  return { states, load, generate };
}
