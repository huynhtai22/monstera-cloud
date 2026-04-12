# Authentication, OAuth & session — logical journey & data isolation

This document defines **how identity is established**, how **sessions work**, and **what must stay true** so one user cannot access another’s data. Treat **§5** as mandatory for any new API or feature.

**Related:** [Console access & payment flows](./ACCESS_AND_PAYMENT_FLOWS.md) — pre/post sign-in, checkout, and webhooks.

---

## 1. User identity (`User.id`) — unique and non-shareable

| Layer | How it works |
|--------|----------------|
| **Primary key** | `User.id` is a `@id @default(cuid())` — globally unique in Postgres (`prisma/schema.prisma`). |
| **Email** | `User.email` is `@unique` — one account per email address. |
| **OAuth link** | `Account` rows tie `provider` + `providerAccountId` (e.g. Google sub) to **exactly one** `userId`. `@@unique([provider, providerAccountId])` prevents the same Google account from attaching to two Monstera users. |

**Implication:** There is no “shared” `User.id` between people. Every API that acts on behalf of a user must resolve **that user’s** `id` from the **verified session** (or from a **workspace-scoped API key**), never from an unverified client string alone.

---

## 2. Session — what “session” means in this app

Monstera uses **NextAuth.js** with **`session: { strategy: "jwt" }`** (`src/lib/auth.ts`).

| Concept | Behavior |
|--------|-----------|
| **Browser session** | A **signed JWT** stored in an **httpOnly** cookie (NextAuth defaults). The client JS cannot read the token contents; only the server can verify it with `NEXTAUTH_SECRET`. |
| **Session payload** | After verification, `getServerSession()` / `getToken()` expose `session.user.id` (copied from JWT claims in `callbacks.session`). That **id** is the **only** user identity trusted for authorization. |
| **Tampering** | If the JWT is altered, signature verification **fails** → no session → `401`. Users **cannot** forge another user’s `id` without the server secret. |
| **“Session ID” (DB)** | Prisma has a `Session` model for the adapter. With **JWT strategy**, the live browser session is **not** looked up by `sessionToken` on each request; trust is **cryptographic (JWT)**. DB `Session` rows may still appear for adapter/OAuth bookkeeping — **authorization still uses `session.user.id` from JWT**, not a client-supplied session id. |
| **Lifetime** | Max age is set in auth config; “Remember me” shortens cookie lifetime when disabled (`rememberMe` in JWT). |

**Middleware** (`src/middleware.ts`) uses `getToken({ secret: NEXTAUTH_SECRET })` for app routes under `/console`, `/overview`, etc. No valid JWT → redirect to `/login` with a **safe** `callbackUrl` (`src/lib/safe-callback-url.ts`) to reduce open-redirect risk.

---

## 3. Login methods — logical journeys

### A. Email + password (Credentials)

1. User submits email + password (+ remember-me).
2. `authorize()` finds `User` by email (case-insensitive), verifies `hashedPassword` with bcrypt, requires `emailVerified`.
3. On success, NextAuth issues a JWT containing **`user.id`** (from DB).
4. **No path** allows logging in as another user without their password.

### B. Google OAuth

1. User is redirected to Google; Google returns an authorization code.
2. NextAuth exchanges the code; Prisma adapter links/creates `User` and `Account` (`provider`, `providerAccountId`).
3. JWT is issued with the same **`user.id`** as stored in `User`.
4. Google **offline** tokens for Sheets/Drive live in `Account` and are loaded by **user id** on the server when running ETL — not exposed to other users’ sessions.

---

## 4. Authorization — ensuring no cross-user data access

**Rule:** Every sensitive API route must:

1. **`getServerSession(authOptions)`** (or equivalent) and reject if `!session?.user?.id`.
2. **Scope by membership:** For workspace data, require `WorkspaceMember` where `userId === session.user.id` and `workspaceId === <resource workspace>`.
3. **Never** use a **client-supplied `userId`** as proof of identity. Optional: accept `workspaceId` in the body/query, but **always** verify membership before reading/writing.

**Patterns in this repo:**

- `findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } })`
- `where: { workspace: { members: { some: { userId: session.user.id } } } }`

**Cron / internal calls:** Use `CRON_SECRET` header where implemented — not a user session; protect those routes and never expose the secret to browsers.

**API keys (e.g. Looker Studio):** `GET /api/looker-studio` uses `Authorization: Bearer <apiKey>`. The key resolves to **one** `ApiKey` row → **one** `workspaceId`. Data queries are filtered by **`keyRecord.workspaceId`**. There is **no** user id in the request — possession of the key **is** the capability (rotate/revoke keys if leaked).

---

## 5. Data leak prevention — mandatory checklist (VERY IMPORTANT)

Use this for code review and new endpoints.

- [ ] **Authenticate** — Session or documented alternative (cron secret, API key) before any private data.
- [ ] **Authorize** — Prove the user **belongs to the workspace** (or owns the resource) **in the database** for every read/write.
- [ ] **Do not trust the client** for identity — `userId` in JSON body must be ignored or checked to match `session.user.id` when used at all.
- [ ] **Scope Prisma queries** — Always include `workspaceId` (and membership filter) or `userId` from session-derived id in the query, not only in application code after fetch.
- [ ] **No IDOR** — Fetching `/api/…/something/[id]` must verify that `id` belongs to a workspace the user is a member of.
- [ ] **Redact responses** — Connection `credentials` must stay encrypted; APIs that return metadata should use existing sanitizers (e.g. workspaces route decrypts only safe fields).
- [ ] **Secrets** — `NEXTAUTH_SECRET`, `CRON_SECRET`, DB URL, API keys only in server env; never `NEXT_PUBLIC_*` for secrets.
- [ ] **Logging** — Avoid logging full tokens, passwords, or decrypted credentials.
- [ ] **Callbacks / redirects** — Use `safeCallbackUrl` (or strict allowlist) for post-login redirects.

---

## 6. Quick reference — files

| Topic | Location |
|--------|----------|
| NextAuth config, JWT, providers | `src/lib/auth.ts` |
| Session typing (JWT `id`) | `src/types/next-auth.d.ts` |
| App route protection | `src/middleware.ts` |
| Safe redirect | `src/lib/safe-callback-url.ts` |
| Schema: User, Account, Session, WorkspaceMember | `prisma/schema.prisma` |

---

## 7. Summary

| Question | Answer |
|----------|--------|
| Is `User.id` unique? | Yes — primary key; email unique; OAuth accounts uniquely bound. |
| Can another user steal a session? | Not without `NEXTAUTH_SECRET` to forge JWT or stealing the user’s cookie (use HTTPS, httpOnly, SameSite). |
| Can User A pass User B’s id in the API? | Must **not** grant access — server must use **only** `session.user.id` and **membership checks**. |
| Session “ID” vs security? | Browser session is a **signed JWT**, not a secret the client can swap for another user’s id. |

*Document version: aligned with NextAuth JWT strategy and current Prisma schema.*
