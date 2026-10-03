import { ZodError } from "zod";
import { getAuthSession } from "@/lib/auth-session";
import { AgentConsoleError } from "./persistence";

/**
 * Enforces console feature flag and returns calling user ID.
 */
export async function consoleUserId(): Promise<string> {
  if (process.env.ENABLE_AGENT_CONSOLE !== "1") {
    throw new AgentConsoleError("not_found", "Agent console is disabled", 404);
  }
  const session = await getAuthSession();
  if (!session?.user?.id) {
    throw new AgentConsoleError("unauthorized", "Sign in to continue", 401);
  }
  return session.user.id;
}

/**
 * Safely parse JSON request body.
 */
export async function consoleJson<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AgentConsoleError("malformed_input", "Invalid JSON request body", 400);
  }
}

/**
 * Formats an error into the standard stable envelope:
 * { code, message, retryable, requiredAction?, currentVersion?, details? }
 */
export function consoleErrorResponse(error: unknown): Response {
  if (error instanceof AgentConsoleError) {
    const retryable = error.code === "stale_version" || error.code === "transaction_conflict" || error.status === 409;
    return Response.json(
      {
        code: error.code,
        message: error.message,
        retryable,
        details: error.details,
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        code: "invalid_input",
        message: "Invalid request parameters",
        retryable: false,
        details: error.issues.map(e => ({ path: e.path.join("."), message: e.message })),
      },
      { status: 400 }
    );
  }

  // Never expose raw DB, Prisma, or provider exceptions to callers
  return Response.json(
    {
      code: "internal_error",
      message: "An internal error occurred while processing the console request",
      retryable: true,
    },
    { status: 500 }
  );
}
