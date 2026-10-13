import Workspace from "@/components/workspace";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-session";

export default async function Home() {
  const user = await getCurrentUser(await headers());
  if (!user) redirect("/login");
  if (!user.emailVerified) redirect("/verify-email");
  return <Workspace user={{ id: user.id, name: user.name, email: user.email }} googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />;
}
