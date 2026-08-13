import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { InvitationClient } from "./InvitationClient";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, session] = await Promise.all([params, getServerSession(authOptions)]);
  return <InvitationClient token={token} signedIn={Boolean(session?.user?.id)} />;
}
