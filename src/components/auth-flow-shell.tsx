import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";
import type { ReactNode } from "react";

export default function AuthFlowShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="auth-page"><div className="auth-top"><Link href="/login" className="brand">scopecheck<span className="brand-dot">.</span></Link><ThemeToggle /></div><section className="auth-card auth-flow-card"><h1>{title}</h1><p>{description}</p>{children}<Link href="/login" className="back-link">Back to sign in</Link></section></main>;
}
