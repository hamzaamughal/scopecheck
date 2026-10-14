"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { AssessmentUsage, GetUsageData } from "@/types/usage";

export function useAssessmentUsage() {
  const [usage, setUsage] = useState<AssessmentUsage>();
  const [error, setError] = useState("");
  const latest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    const version = ++latest.current;
    controller.current?.abort();
    const pending = new AbortController(); controller.current = pending;
    return apiRequest<GetUsageData>("/api/usage", { signal: pending.signal }).then(data => {
      if (latest.current === version && !pending.signal.aborted) { setUsage(data.usage); setError(""); }
    }).catch(() => {
      if (latest.current === version && !pending.signal.aborted) setError("Could not refresh your AI allowance.");
    });
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { controller.current?.abort(); window.removeEventListener("focus", focus); };
  }, [refresh]);
  useEffect(() => {
    if (!usage) return;
    const timer = setTimeout(() => void refresh(), Math.max(1000, Date.parse(usage.resetsAt) - Date.now() + 1000));
    return () => clearTimeout(timer);
  }, [usage, refresh]);
  return { usage, error, refresh };
}
