import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";

type Props = {
  children: ReactNode;
  params: Promise<{ agencySlug: string }>;
};

/**
 * Ensures the hostname-derived agency slug matches an existing workspace slug before serving
 * tenant-scoped app routes under `/agencies/[agencySlug]/…`.
 */
export default async function AgencySlugLayout({ children, params }: Props) {
  const { agencySlug } = await params;
  const workspace = await prisma.workspace.findFirst({
    where: { slug: agencySlug },
    select: { id: true },
  });
  if (!workspace) {
    notFound();
  }
  return children;
}
