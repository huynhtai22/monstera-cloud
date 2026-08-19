import prisma from "@/lib/prisma";
import { isConnectEnabled } from "@/lib/integration-flags";

export class ProviderAccessError extends Error {
  readonly code = "PROVIDER_NOT_ENABLED";
  readonly statusCode = 403;

  constructor(message = "Provider is not enabled for this workspace") {
    super(message);
    this.name = "ProviderAccessError";
  }
}

export function toProviderAccessResponse(error: unknown): Response | null {
  if (!(error instanceof ProviderAccessError)) return null;
  return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
}

export async function assertWorkspaceProviderEnabled(opts: {
  workspaceId: string;
  provider: string;
}): Promise<void> {
  if (!opts.workspaceId || !opts.provider) {
    throw new ProviderAccessError("Provider is not enabled for this workspace");
  }
  if (!isConnectEnabled(opts.provider)) {
    throw new ProviderAccessError(`Provider "${opts.provider}" is not available`);
  }

  const access = await prisma.workspaceProviderAccess.findUnique({
    where: {
      workspaceId_provider: {
        workspaceId: opts.workspaceId,
        provider: opts.provider,
      },
    },
    select: { enabled: true },
  });

  if (!access?.enabled) {
    throw new ProviderAccessError("Provider is not enabled for this workspace");
  }
}

export async function listEnabledWorkspaceProviders(workspaceId: string): Promise<Set<string>> {
  const rows = await prisma.workspaceProviderAccess.findMany({
    where: { workspaceId, enabled: true },
    select: { provider: true },
  });
  return new Set(rows.map((row) => row.provider).filter((provider) => isConnectEnabled(provider)));
}
