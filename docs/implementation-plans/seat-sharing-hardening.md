# Seat-sharing hardening — implementation plan

> Status 2026-09-20: **P0 + P1 + P2 + P3 implemented and verified locally;
> not deployed** (migrations
> `20260919000000_seat_sharing_p0_telemetry`,
> `20260919000001_seat_sharing_p1_sessions`,
> `20260920000000_workspace_daily_usage`, and
> `20260920000001_flexible_session_allowance`; apply with Prisma migrate
> deploy). Agency Pro and Enterprise remain the only public commercial
> offers. `free` is the expiry fallback, `pilot` is the seven-day Agency Pro
> trial, `starter` is legacy compatibility, and `professional` is the internal
> Agency Pro identifier. Their normal browser allowances are respectively
> 3, 8, 4, 8, and 15, plus one temporary 24-hour overflow browser.
> Self-service device review/revocation remains the default. Deferred: OTP
> step-up, workspace-owner revocation of member sessions, and a console
> over-seat banner.
> Follow-up audit: per-user advisory transaction locks now make session caps
> exact under concurrent login; per-workspace advisory locks make API-key cap
> decisions and lifecycle audits atomic; every bearer-key route uses the same
> IP-pin resolver. Tenant admins no longer receive user-global login history.

Base inspected: workspace `monstera-cloud` at `src/lib/auth.ts`, `src/proxy.ts`, `src/lib/plan-entitlements.ts`, `src/lib/plan-config.ts`, `src/lib/api-key-security.ts`, `prisma/schema.prisma`. Do not deploy, charge, or contact providers from this plan. Follow `AGENTS.md` (Node >= 22, Postgres + `npx prisma db push` for local verify, `npm run lint` scoped to `src/`).

## 1. Problem

One paid seat can serve N humans today:

1. **Password sharing is free.** Auth is stateless NextAuth JWT (`src/lib/auth.ts:172-175`, `strategy: "jwt"`, 30d max age). `prisma/schema.prisma:50-56` `Session` rows are adapter bookkeeping only — authorization uses `session.user.id` from JWT (`docs/AUTH_SECURITY_JOURNEY.md §2`). No `jti`, no device/IP record, no concurrent-session limit, no server revoke. `signOut` is client cookie clear; stolen/shared JWT stays valid until expiry.
2. **Invite cap is the only seat gate.** `assertCanInviteSeat()` (`src/lib/plan-entitlements.ts:298-314`) counts `WorkspaceMember + pending WorkspaceInvitation` and is called only in `POST /api/workspaces/[id]/invitations` (`src/app/api/workspaces/[id]/invitations/route.ts:38`). Limits: `free:1, pilot:5, starter/professional/enterprise:50` (`src/lib/plan-config.ts:97-205`). Nothing stops 5 people sharing 1 member login.
3. **API-key sharing is free.** `resolveApiKey()` (`src/lib/api-key-security.ts:25-32`) maps bearer → `workspaceId`, no user binding, no IP bind, no concurrency check. Only `lastUsedAt` is updated (`src/app/api/looker-studio/route.ts:191-194`, `src/app/api/export/rows/route.ts:361`). One `mc_live_*` key powers unlimited Looker/Sheets/REST clients. Per-key rate limit exists (`src/app/api/looker-studio/route.ts:28-57`) but is anti-burst, not anti-share.
4. **Sheets Google-JWT sharing.** `GET /api/looker-studio` JWT branch (`src/app/api/looker-studio/route.ts:122-170`) + `POST /api/addon/auth` grant full workspace list to whoever holds a valid Google ID token for that email. No new-device check, no login audit (`AuditEvent` only logs `invitation.created`, `api_key.created/revoked`).

Goal: make 1-seat sharing **visible → frictionful → enforceable**, without breaking legit agency multi-device use or the Sheets/Looker service-account patterns.

Non-goals: no second billing system (Paddle + Workspace.plan stays source of truth), no Postgres RLS, no live price changes, no hourly-cron promises beyond `SELF_SERVE_PLANS.md`.

## 2. Threat model (what we block, what we allow)

| Vector | Today | Target |
|---|---|---|
| Same email+password on 5 laptops/browsers | allowed, invisible | visible in Sessions UI; over-limit blocked/revoked |
| Same Google OAuth identity on N devices | allowed | same as above (one `userId`, N `jti`) |
| Shared `mc_live_*` key in Looker/Sheets/REST | allowed, `actor=api-key:<id>` only in delivery receipts | per-key attribution + usage stats + optional IP-pin + key-count cap |
| Shared dashboard/export link | `UserDashboard.isShared` exists, no seat check | watermark + signed short-lived links (Phase 3) |
| Legit: owner has laptop + phone; agency has 2 staff on 1 Studio seat | must keep working | concurrent limit = generous (e.g. 3 browser + 5 key-IPs), warn before block |

## 3. Phased rollout

### Phase 0 — telemetry only, zero breakage (1 slice)

1. Add read-only observability:
   - `LoginEvent(id, userId, method, ipHash, uaHash, createdAt)` written on credentials `authorize()` success + Google `signIn()` + `addon/auth` success. Hash IP with `SHA-256(ip + LOGIN_IP_SALT)` — never store raw IP.
   - Extend `ApiKey` usage: `lastUsedIpHash`, `lastUsedUaHash`, `useCount` (increment on Looker/export/rows hits). Reuse existing `lastUsedAt` update sites.
   - Owner-only `GET /api/workspaces/[id]/sharing-signals` returning: distinct `ipHash`/`uaHash` per user (7d/30d), concurrent-heartbeat estimate, per-key IP fan-out. No enforcement.
2. Tests: unit on hashing + integration on event writes. Verify: `npm run lint`, `npm run typecheck`, existing `plan-entitlements.test.ts`.
3. Success gate: can answer "% of 1-seat workspaces with ≥3 IPs in 7d" without user complaints.

### Phase 1 — revocable sessions + concurrent limit (core hardening)

1. Schema (new migration, additive only):
   ```prisma
   model UserSession {
     id        String   @id @default(cuid())
     userId    String
     jti       String   @unique
     ipHash    String?
     uaHash    String?
     createdAt DateTime @default(now())
     lastSeenAt DateTime @default(now())
     revokedAt DateTime?
     user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
     @@index([userId, lastSeenAt])
   }
   // + User.sessions UserSession[], LoginEvent model from Phase 0
   // + ApiKey: createdByUserId String?, lastUsedIpHash String?, useCount Int @default(0)
   ```
2. Auth changes (`src/lib/auth.ts`, `src/types/next-auth.d.ts`):
   - `jwt()` issues `token.jti = crypto.randomUUID()` on sign-in only; preserves `rememberMe` expiry behavior.
   - `jwt()` + `session()` look up `UserSession(jti)`; if `revokedAt != null` return `null` (forces re-login). Cache negative/positive in Upstash via `createNodeRedis()` (`src/lib/node-redis.ts`) with 60s TTL to avoid DB hot path; fail-open on Redis outage (log + allow, same pattern as `looker-studio` rate-limit fail-open).
   - `events.signIn` (or post-`authorize`) creates `UserSession` + `LoginEvent` rows. Cap: delete `revokedAt != null` rows older than 90d in same write (bounded).
3. Enforcement policy (new `src/lib/session-limits.ts`, pure + Prisma):
   - `maxConcurrentSessions(plan)`: `free:3, starter:4, professional:8, pilot:8, enterprise:15`, plus one 24-hour overflow browser. Enforce on **create** (login): the first overflow receives grace; further overflow preserves the original deadline and revokes the oldest browser. Heartbeat cleanup returns an expired account to its normal allowance.
   - Heartbeat: update `lastSeenAt` at most once per 10 min per `jti` (in `session()` callback, fire-and-forget, never block login on failure).
4. Edge constraint: `src/proxy.ts` stays JWT-verify only (no DB in edge). Hard block happens in Node (`getAuthSession` wrapper + sensitive routes via `requireWorkspaceAccess`). Stolen `jti` dies within ≤60s (Redis TTL) / next DB check.
5. New routes (all `getAuthSession` + self-only except owner list):
   - `GET /api/auth/sessions` — list own sessions (current `jti` flagged via JWT claim).
   - `POST /api/auth/sessions/revoke` `{ jti }` — revoke one of the caller's own sessions or all of the caller's other sessions. Workspace-owner revocation of another member remains deferred because sessions are global to the user, not workspace-scoped.
   - `GET /api/auth/login-events?days=30` — own history; owner sees aggregated counts only (no raw IPs).
6. UI: `Settings → Sessions` tab (reuse `ApiKeysTab` pattern): device label (parsed UA), last seen, Revoke + "Sign out all others". Reuse `src/lib/mail.ts` Resend path for new-device email (same salt-hash, include "wasn't you? revoke" link).
7. Tests: `session-limits.test.ts` (pure cap logic), pg-integration for revoke-oldest race (two concurrent logins → 1 revoked), proxy test unchanged, Playwright login→sessions→revoke→401 journey.

### Phase 2 — API-key attribution + caps

1. `assertCanCreateApiKey` today is boolean (`allowApiKeys`). Extend to count cap: `maxKeys(plan)`: `free:0, starter:3, professional:10, pilot:10, enterprise:25`. Enforce in `POST /api/settings/api-keys` before `generateApiKey()`.
2. Attribute every key use: `createdByUserId` on create; on each Looker/export hit update `useCount`, `lastUsedIpHash/uaHash` (single `updateMany`, no read-modify-write).
3. Optional per-key IP-pin (`ApiKey.allowedIpHashPrefix String?`): owner sets "pin to office IP" from Sessions UI; mismatch → 403 `API_KEY_IP_PINNED` + `AuditEvent`. Default off (Looker refreshes come from Google IPs — never pin by default).
4. UI: keys table gains `uses (7d)`, `IPs (7d)`, creator, Rotate button (`POST /api/settings/api-keys/rotate` = create + revoke old atomically, returns secret once). Keep `publicApiKeyRow` masked shape.
5. Tests: key-cap 403, rotate invalidates old secret, IP-pin allow/deny.

### Phase 3 — anomaly friction + export watermark (follow-up, not in v1 slice)

- New-device OTP step-up reusing `User.otp*` columns when `ipHash` unseen in 30d (email code, 10-min TTL, existing `auth-rate-limit.ts` bucket).
- Concurrent-heartbeat presence: client pings `POST /api/auth/heartbeat` every 5 min with `jti`; server flags `>limit` simultaneous `jti`s in 10-min window → owner nudge email + console banner with upgrade path (`suggestedUpgradePlan`).
- Watermark CSV/REST/Sheets payloads with `workspace + actor + timestamp` footer; signed short-lived share links replacing raw `isShared` reads.
- Pricing lever: keep 50-seat abuse cap; add paid "extra seat" or free `viewer` role expansion so sharing has a legal cheap path.

## 4. Files to touch (v1 slice = Phase 0 + 1)

- `prisma/schema.prisma` + migration: `UserSession`, `LoginEvent`, `ApiKey` extras.
- `src/lib/auth.ts`, `src/types/next-auth.d.ts`, new `src/lib/session-limits.ts`, `src/lib/sharing-signals.ts`.
- `src/lib/auth-session.ts`: centralize revocation check so all `getServerSession` callers inherit it.
- `src/app/api/auth/sessions/route.ts`, `src/app/api/auth/login-events/route.ts`, `src/app/api/workspaces/[id]/sharing-signals/route.ts`.
- `src/app/(app)/settings/*`: Sessions tab + keys usage columns.
- `src/lib/plan-config.ts`: add `maxConcurrentSessions`, `maxApiKeys` to `PlanLimits` + `PLAN_LIMITS` table (defaults above).
- Tests: `src/lib/session-limits.test.ts`, `*.pg.integration.test.ts` for login/revoke race.

## 5. Verification

- `npx prisma migrate deploy` on disposable local Postgres, `npm run create-smoke-user:pro`, `npm run seed-demo-metrics`.
- `npm run lint`, `npm run typecheck`, `npm test` (run-test-suite.mjs), targeted pg-integration, `next build --webpack`.
- Manual: login 2 browsers → Sessions lists 2 → revoke one → revoked browser 401s to `/login`; 4th login on `free` receives 24-hour grace; 5th login revokes the oldest while preserving the deadline; Redis down → logins still succeed (fail-open).
- No CSP change needed (no new third-party). No new env required except optional `LOGIN_IP_SALT` (fallback `NEXTAUTH_SECRET`); document in `.env.example`.

## 6. Risks / open questions

- Google-bound Looker scheduled refreshes fan out across Google IPs — IP-count heuristics must never auto-revoke keys; warn only.
- Sheets add-on uses short-lived Google ID tokens per open — treat each `addon/auth` as event, not as a persistent `UserSession`.
- Concurrent mobile + desktop is normal — limits above are deliberately generous; tighten only after Phase-0 data.
- Open: revoke-oldest vs block-newest? Recommend revoke-oldest for v1, revisit if support load rises. Open: include `viewer` in seat cap? Yes — counts today via `WorkspaceMember`, keep.
