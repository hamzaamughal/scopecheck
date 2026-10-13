import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-session";
import AuthEmailRequest from "@/components/auth-email-request";

export default async function VerifyEmailPage() {
  const user = await getCurrentUser(await headers());
  if (user?.emailVerified) redirect("/");
  return <AuthEmailRequest kind="verify" initialEmail={user?.email} />;
}
