import type { Metadata } from "next";
import ResetPasswordForm from "@/components/reset-password-form";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={token} invalid={Boolean(error)} />;
}
