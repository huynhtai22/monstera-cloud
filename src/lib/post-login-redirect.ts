import { safeCallbackUrl } from "@/lib/safe-callback-url";
import { isPaidSubscriptionPlan } from "@/lib/plan-config";

/**
 * After sign-in, paid users go to their requested destination.
 * Free-tier users are steered to /pricing when they would have landed on /sources
 * so they see plans and checkout first (realistic buyer journey). They can still
 * open /sources from the nav for Free-tier limits.
 *
 * If `plan` is missing (session not fully hydrated), we send the user to the safe
 * requested path instead of /pricing so OAuth users with DB `professional` etc.
 * are not misclassified when `token.id` was absent on the first session read.
 */
export function getPostLoginRedirectPath(
  plan: string | undefined,
  requestedPath: string
): string {
  const safe = safeCallbackUrl(requestedPath, "/console");
  const path = safe.split("?")[0] || "/";

  if (plan === undefined || plan === null || plan === "") {
    return safe;
  }

  if (isPaidSubscriptionPlan(plan)) {
    return safe;
  }

  if (path === "/sources" || path.startsWith("/sources/") || path === "/console" || path.startsWith("/console/")) {
    return "/pricing";
  }

  return safe;
}
