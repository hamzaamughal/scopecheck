import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-session";
import LoginForm from "@/components/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; verified?: string; reset?: string }> }) {
  const user = await getCurrentUser(await headers());
  if (user) redirect(user.emailVerified ? "/" : "/verify-email");
  const { error, verified, reset } = await searchParams;
  return <LoginForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} oauthError={error === "google"} notice={error ? "That link or sign-in attempt could not be completed. Request a new email link or try signing in again." : reset === "1" ? "Your password has been reset. Sign in with your new password." : verified === "1" ? "Your email is verified. Sign in to continue." : ""} />;
}
