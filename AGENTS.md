## Cursor Cloud specific instructions

- **App shell / click-through**: on large screens, `AppLayout` uses a **full-width** `lg:sticky` top strip for `NotificationCenter` (`z-20`) above `main` (`z-10`). That strip must use `pointer-events-none` on the row and `pointer-events-auto` on the bell control only; otherwise empty flex space overlaps scrolling page content and **intercepts clicks** (e.g. setup wizard CTAs, links).

- **Node.js version**: this repo requires **Node >= 20.9** (Next.js 16). If `npm run dev` complains about Node version, upgrade Node before running anything.

- **Database**: the app expects a **PostgreSQL** `DATABASE_URL`. For local/Cloud Agent verification, a simple local Postgres is sufficient, then run `npx prisma db push` (see `README.md`).

- **Linting (Next.js 16)**: `next lint` is removed in Next.js 16, so lint is run via `npm run lint` (ESLint CLI). The command is scoped to `src/` to avoid linting non-app tooling directories.

- **Core “hello world” for this repo** (warehouse/data explorer):
  - Create the smoke user: `npm run create-smoke-user:pro`
  - Seed demo warehouse rows: `npm run seed-demo-metrics`
  - You can sanity-check warehouse rows via SQL on table `"CampaignMetric"`.

