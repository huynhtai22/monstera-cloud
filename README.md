# 🌿 Monstera Cloud - Headless Data Ingestion Fabric

Monstera Cloud is a Next.js app for APAC sellers and agencies: OAuth connections to marketplaces and ad platforms (e.g. Shopee, TikTok, Meta, Google Ads), workspace-scoped pipelines, and delivery into **Google Sheets™** and **Looker Studio™** (plus Slack-style alerts where enabled) — shipped in the console today.

## 🛠 Tech Stack

*   **Framework:** Next.js 14 App Router (React)
*   **Database ORM:** Prisma
*   **Authentication:** NextAuth.js
*   **Styling:** Tailwind CSS (Enterprise Dark / Zinc-950 aesthetic)
*   **Icons:** Lucide React

---

## 🚀 Getting Started

Follow these instructions to set up and run the Monstera Cloud platform locally.

### 1. Prerequisites
Ensure you have the following installed on your machine:
*   Node.js (v18+)
*   npm (v9+)
*   A running PostgreSQL database (or compatible SQL provider)

### 2. Installation
Clone the repository and install the required dependencies:

```bash
git clone https://github.com/huynhtai22/monstera-cloud.git
cd monstera-cloud
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory and configure the necessary environment variables. You can use `.env.example` as a reference if available.

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/monstera?schema=public"

# Authentication (NextAuth)
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-generated-secret-key"

# Integrations (Example)
NEXT_PUBLIC_SHOPEE_APP_ID="your-shopee-app-id"
SHOPEE_APP_SECRET="your-shopee-app-secret"
```
*(Note: Generate a random `NEXTAUTH_SECRET` using `openssl rand -base64 32`)*

### 4. Database Setup
Run Prisma to sync your database schema and generate the strongly-typed client:

```bash
npx prisma generate
npx prisma db push
```
*(Use `npx prisma migrate dev` if you are tracking migration history).*

### 5. Running the Application
Start the Next.js development server:

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000).

---

## 📁 Project Structure

*   **/src/app:** Next.js App Router endpoints, pages, and layouts.
    *   `/(marketing)`: The public-facing landing page, pricing, and documentation hub.
    *   `/(auth)`: Custom login and registration flows.
    *   `/console`: The protected application core for managing pipelines and workspaces.
    *   `/api`: REST endpoints and webhook listeners.
*   **/src/components:** Reusable React UI components (Navbar, Footer, SVGs).
*   **/prisma:** Database schema and migration files.

## 🔒 Security
All API routes are protected via NextAuth. Ensure your testing environment has a valid user registered before attempting to access `/console` or trigger `/api/pipelines`.
