"use client";

// Runs once during HTML parsing (before paint). On the client React sees type="text/plain",
// so it neither re-runs nor warns about rendering a <script>. Pattern from Next.js docs.
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
