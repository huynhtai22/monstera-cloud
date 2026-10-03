import { z } from "zod";

export const ConsoleRole = z.enum(["viewer", "member", "admin", "owner", "system_worker"]);
export type ConsoleRole = z.infer<typeof ConsoleRole>;

export const ConsoleAction = z.enum([
  "read_data_and_cases",
  "reconnect_provider",
  "create_responsibility",
  "modify_responsibility_scope",
  "grant_recovery_authorization",
  "submit_data_recovery",
  "approve_recovery_operation",
  "snooze_case",
  "manual_resolve_case",
  "change_campaign_or_budget", // STRICTLY DISABLED through C7
  "send_external_report",      // STRICTLY DISABLED through core pilot
]);
export type ConsoleAction = z.infer<typeof ConsoleAction>;

/**
 * Server-validated unattended recovery policy.
 * Persisted in the database and re-checked at runtime immediately before any background action.
 * A simple boolean flag is explicitly rejected per C0 security contract.
 */
export interface RecoveryAuthorizationPolicy {
  id: string;
  workspaceId: string;
  responsibilityId: string;
  authorizingUserId: string;
  authorizingUserRole: "admin" | "owner";
  scopeRevision: number;
  scopeHash: string;
  allowedConnectionIds: readonly string[];
  allowedProviderAccountIds: readonly string[];
  allowedPairs?: readonly {
    provider: string;
    connectionId: string;
    providerAccountId: string;
  }[];
  maxWindowDays: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Server-validated interactive recovery approval.
 * Single-use approval created by an authenticated user for an exact proposal.
 */
export interface InteractiveRecoveryApproval {
  approvalId: string;
  workspaceId: string;
  proposalHash: string;
  approverUserId: string;
  approverRole: "member" | "admin" | "owner";
  operationId: string;
  evidenceFingerprint: string;
  policyRevision: number;
  approvedAt: Date;
  expiresAt: Date;
  isSingleUseConsumed: boolean;
}

export interface AuthorityContext {
  role: ConsoleRole;
  userId: string;
  workspaceId: string;
  isWorkspaceMember: boolean;
  isOwnerOrCreator?: boolean;
  isInteractiveUser?: boolean;
  
  // Interactive recovery approval (single-use, user present)
  interactiveApproval?: InteractiveRecoveryApproval;
  targetProposalHash?: string;
  targetOperationId?: string;
  targetEvidenceFingerprint?: string;
  targetPolicyRevision?: number;
  
  // Unattended recovery authorization (durable policy, background worker)
  unattendedPolicy?: RecoveryAuthorizationPolicy;
  authorizingUserCurrentRole?: ConsoleRole;
  
  // Target execution scope to validate against policy (mandatory for unattended recovery)
  targetResponsibilityId?: string;
  currentScopeRevision?: number;
  currentScopeHash?: string;
  targetProvider?: string;
  targetConnectionId?: string;
  targetProviderAccountId?: string;
  targetWindowDays?: number;
  currentTime?: Date;
}

export interface AuthorityEvaluationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Atomically consumes an interactive recovery approval, enforcing single-use safety.
 */
export function consumeInteractiveRecoveryApproval(approval: InteractiveRecoveryApproval): InteractiveRecoveryApproval {
  if (approval.isSingleUseConsumed) {
    throw new Error("Interactive recovery approval has already been consumed");
  }
  if (approval.expiresAt <= new Date()) {
    throw new Error("Interactive recovery approval has expired");
  }
  return {
    ...approval,
    isSingleUseConsumed: true,
  };
}

/**
 * Validates whether recovery execution is authorized under either:
 * 1) A valid, unconsumed interactive approval from an authorized user, OR
 * 2) A valid, unrevoked, unexpired unattended policy where the authorizing admin retains their role
 *    and the target scope/window falls strictly within the policy bounds.
 */
export function validateRecoveryAuthorization(context: AuthorityContext): AuthorityEvaluationResult {
  const now = context.currentTime ?? new Date();

  // Mode 1: Interactive Approval
  if (context.isInteractiveUser && context.interactiveApproval) {
    const approval = context.interactiveApproval;
    
    // Persisted tenant binding
    if (approval.workspaceId !== context.workspaceId) {
      return { allowed: false, reason: "Interactive recovery approval workspace mismatch" };
    }
    if (approval.isSingleUseConsumed) {
      return { allowed: false, reason: "Interactive recovery approval has already been consumed" };
    }
    if (approval.expiresAt <= now) {
      return { allowed: false, reason: "Interactive recovery approval has expired" };
    }
    if (context.role !== "admin" && context.role !== "owner" && (!context.isOwnerOrCreator || context.role !== "member")) {
      return { allowed: false, reason: "Current user role is not authorized to execute recovery" };
    }
    
    // Exact approval binding: verify operation, proposal, evidence, and policy revision match
    if (
      !context.targetOperationId ||
      !context.targetProposalHash ||
      !context.targetEvidenceFingerprint ||
      context.targetPolicyRevision === undefined
    ) {
      return {
        allowed: false,
        reason: "Target operation ID, proposal hash, evidence fingerprint, and policy revision are mandatory for interactive recovery approval execution",
      };
    }
    if (context.targetProposalHash !== approval.proposalHash) {
      return { allowed: false, reason: "Interactive approval proposal hash does not match target proposal hash" };
    }
    if (context.targetOperationId !== approval.operationId) {
      return { allowed: false, reason: "Interactive approval operation ID does not match target operation ID" };
    }
    if (context.targetEvidenceFingerprint !== approval.evidenceFingerprint) {
      return { allowed: false, reason: "Interactive approval evidence fingerprint does not match target evidence fingerprint" };
    }
    if (context.targetPolicyRevision !== approval.policyRevision) {
      return { allowed: false, reason: "Interactive approval policy revision does not match target policy revision" };
    }
    return { allowed: true };
  }

  // Mode 2: Unattended Autonomous Policy
  if (context.unattendedPolicy) {
    const policy = context.unattendedPolicy;

    // Tenant check
    if (policy.workspaceId !== context.workspaceId) {
      return { allowed: false, reason: "Recovery policy workspace mismatch" };
    }

    // Revocation check
    if (policy.revokedAt !== null) {
      return { allowed: false, reason: `Recovery policy was revoked at ${policy.revokedAt.toISOString()}` };
    }

    // Expiration check
    if (policy.expiresAt <= now) {
      return { allowed: false, reason: `Recovery policy expired at ${policy.expiresAt.toISOString()}` };
    }

    // Authorizing user current role check: Authorizer must currently remain admin or owner
    if (context.authorizingUserCurrentRole !== "admin" && context.authorizingUserCurrentRole !== "owner") {
      return {
        allowed: false,
        reason: "Authorizing user has lost admin/owner role in workspace; policy is invalidated",
      };
    }

    // Mandatory target context check: unattended recovery must explicitly specify responsibility, revisions, scope hash, provider, connection, account, and window
    if (
      !context.targetResponsibilityId ||
      context.currentScopeRevision === undefined ||
      !context.currentScopeHash ||
      !context.targetProvider ||
      !context.targetConnectionId ||
      !context.targetProviderAccountId ||
      context.targetWindowDays === undefined
    ) {
      return {
        allowed: false,
        reason: "Target recovery context (targetResponsibilityId, currentScopeRevision, currentScopeHash, targetProvider, targetConnectionId, targetProviderAccountId, targetWindowDays) is mandatory for unattended recovery execution",
      };
    }

    // Responsibility identity check
    if (context.targetResponsibilityId !== policy.responsibilityId) {
      return {
        allowed: false,
        reason: `Target responsibility '${context.targetResponsibilityId}' does not match authorized policy responsibility '${policy.responsibilityId}'`,
      };
    }

    // Scope revision check
    if (context.currentScopeRevision !== policy.scopeRevision) {
      return {
        allowed: false,
        reason: `Scope revision mismatch (policy: ${policy.scopeRevision}, current: ${context.currentScopeRevision}). Scope was modified; reauthorization required.`,
      };
    }

    // Exact scope hash check
    if (context.currentScopeHash !== policy.scopeHash) {
      return {
        allowed: false,
        reason: `Scope hash mismatch (policy: ${policy.scopeHash}, current: ${context.currentScopeHash}). Scope accounts/configuration changed; reauthorization required.`,
      };
    }

    // Valid date bounds check
    if (context.targetWindowDays <= 0 || context.targetWindowDays > policy.maxWindowDays) {
      return {
        allowed: false,
        reason: `Target window (${context.targetWindowDays} days) must be positive and not exceed authorized maximum (${policy.maxWindowDays} days)`,
      };
    }

    // Authorized provider/connection/account pair check
    if (policy.allowedPairs && policy.allowedPairs.length > 0) {
      const pairAllowed = policy.allowedPairs.some(
        pair =>
          pair.provider === context.targetProvider &&
          pair.connectionId === context.targetConnectionId &&
          pair.providerAccountId === context.targetProviderAccountId,
      );
      if (!pairAllowed) {
        return {
          allowed: false,
          reason: `Target provider/connection/account pair ('${context.targetProvider}:${context.targetConnectionId}:${context.targetProviderAccountId}') is not authorized in recovery policy`,
        };
      }
    } else {
      // Fallback check against independent connection and account lists
      if (!policy.allowedConnectionIds.includes(context.targetConnectionId)) {
        return {
          allowed: false,
          reason: `Target connection '${context.targetConnectionId}' is not authorized in recovery policy`,
        };
      }
      if (!policy.allowedProviderAccountIds.includes(context.targetProviderAccountId)) {
        return {
          allowed: false,
          reason: `Target account '${context.targetProviderAccountId}' is not authorized in recovery policy`,
        };
      }
    }

    return { allowed: true };
  }

  // Admin / Owner interactive direct execution
  if (context.isInteractiveUser && (context.role === "admin" || context.role === "owner")) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "Data recovery requires either valid interactive approval or a server-validated unattended recovery policy",
  };
}

/**
 * Checks whether an actor with a given role and context is authorized to perform a console action.
 * Enforces the non-negotiable trust matrix.
 */
export function canPerformAction(
  action: ConsoleAction,
  context: AuthorityContext,
): AuthorityEvaluationResult {
  // Hard gate 1: Provider campaign/budget mutations are strictly disabled through C7
  if (action === "change_campaign_or_budget") {
    return {
      allowed: false,
      reason: "Provider campaign/budget mutations are disabled through milestone C7 and require a separate write certification gate",
    };
  }

  // Hard gate 2: External report/message delivery is strictly disabled through core pilot
  if (action === "send_external_report") {
    return {
      allowed: false,
      reason: "External report/message delivery is disabled through core pilot and requires exact-dataset readiness gates in C8",
    };
  }

  // All actions require active workspace membership
  if (!context.isWorkspaceMember) {
    return {
      allowed: false,
      reason: "Caller is not an active member of this workspace",
    };
  }

  const { role, isOwnerOrCreator, isInteractiveUser } = context;

  // Viewers may only read
  if (role === "viewer") {
    if (action === "read_data_and_cases") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Viewers have read-only access to cases and evidence",
    };
  }

  // Provider reconnection requires an interactive user at the provider consent screen
  if (action === "reconnect_provider") {
    if (!isInteractiveUser) {
      return {
        allowed: false,
        reason: "Provider reconnection requires interactive customer action at the provider consent screen",
      };
    }
    return { allowed: true };
  }

  // Read data and cases
  if (action === "read_data_and_cases") {
    return { allowed: true };
  }

  // Snooze case / manual resolve
  if (action === "snooze_case" || action === "manual_resolve_case") {
    if (role === "member" || role === "admin" || role === "owner") {
      return { allowed: true };
    }
    return { allowed: false, reason: "Insufficient role to update case status" };
  }

  // Create responsibility
  if (action === "create_responsibility") {
    if (role === "member" || role === "admin" || role === "owner") {
      return { allowed: true };
    }
    return { allowed: false, reason: "Must be a workspace member, admin, or owner to create a responsibility" };
  }

  // Modify responsibility scope
  if (action === "modify_responsibility_scope") {
    if (role === "owner" || role === "admin" || (role === "member" && isOwnerOrCreator)) {
      return { allowed: true };
    }
    return { allowed: false, reason: "Only the responsibility owner, admin, or workspace owner can modify its scope" };
  }

  // Grant autonomous recovery authorization
  if (action === "grant_recovery_authorization") {
    if (role === "admin" || role === "owner") {
      return { allowed: true };
    }
    return { allowed: false, reason: "Only workspace admins or owners may grant autonomous data recovery permissions" };
  }

  // Submit data recovery: must pass server-validated policy or interactive approval
  if (action === "submit_data_recovery") {
    return validateRecoveryAuthorization(context);
  }

  // Approve recovery operation
  if (action === "approve_recovery_operation") {
    if (role === "owner" || role === "admin" || (role === "member" && isOwnerOrCreator)) {
      return { allowed: true };
    }
    return { allowed: false, reason: "Insufficient role to approve recovery operations" };
  }

  return { allowed: false, reason: "Unknown or unauthorized action" };
}

export class AuthorityError extends Error {
  constructor(public readonly action: ConsoleAction, message: string) {
    super(message);
    this.name = "AuthorityError";
  }
}

export function assertAuthority(action: ConsoleAction, context: AuthorityContext): void {
  const result = canPerformAction(action, context);
  if (!result.allowed) {
    throw new AuthorityError(action, result.reason || `Action '${action}' is not authorized`);
  }
}
