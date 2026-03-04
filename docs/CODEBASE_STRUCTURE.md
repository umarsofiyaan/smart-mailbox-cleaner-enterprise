# Codebase Structure Overview

This document summarizes the architecture and folder layout of the Smart Mailbox Cleaner repository.

## Monorepo Layout

- `backend/`: Express API server, Gmail integration, quota/subscription logic, and async job worker.
- `frontend/`: React + Vite web app for onboarding, scanning, cleanup, and account management.
- `extension/`: Chrome MV3 extension (popup + background worker) with OAuth-assisted integration.
- `docs/`: setup/deployment/security docs.
- Root SQL migration files (`*_MIGRATION.sql`, `ROUND3_MIGRATION.sql`, `BATCH3_MIGRATION.sql`): database schema evolution scripts.

## Backend (`backend/src`)

### Entry and middleware

- `app.js`: server bootstrap; initializes Sentry first, applies security middleware, mounts route modules, exposes health endpoints, starts HTTP listener, and starts the job worker.
- `middleware/`:
  - `security.js`: Helmet, CORS, global limiter, auth limiter, and related request protections.
  - `auth.js`: JWT verification helpers and `requireAuth` middleware.
  - `requirePro.js`: authorization gate for paid/pro features.

### Route layer (`routes/`)

- `auth.js`: Google OAuth flow, session token handling, login/logout, refresh, and account deletion logic.
- `scan.js`: scan launch/status/results and custom scan endpoints.
- `cleanup.js`: cleanup execution, undo, and cleanup history endpoints.
- `subscription.js`: plan checkout/cancel/status and webhook handling.
- `automation.js`: user playbook CRUD, preview, run queueing, and insights endpoints.
- `admin.js`: admin-only operational/analytics endpoints.

### Service layer (`services/`)

- Gmail + scanning domain:
  - `gmailService.js`: Gmail API client/fetch utilities.
  - `scanEngine.js`: scan execution and category matching.
  - `confidenceEngine.js`: confidence scoring for cleanup suggestions.
- Cleanup + automation domain:
  - `cleanupService.js`: trash move/undo and bytes-freed accounting.
  - `playbookService.js`: automation playbook storage, scheduling metadata, and run orchestration.
- Auth/subscription/quota domain:
  - `tokenService.js`: encrypted OAuth token persistence + refresh-token hash management.
  - `quotaService.js`: free/pro quota tracking and enforcement.
  - `stripeService.js`: payment/subscription webhook processing.
  - `emailService.js`: transactional email notifications (welcome, receipts, quota notices).

### Async jobs and infra

- `jobs/worker.js`: polls DB-backed jobs queue, executes SCAN/CUSTOM_SCAN/CLEANUP/PLAYBOOK_RUN jobs, updates progress payloads, and handles retries/failures.
- `config/`: integrations and infrastructure bootstrapping (`database.js`, `google.js`, `stripe.js`, `sentry.js`, `migrate.js`).
- `utils/`: shared helpers (`logger.js`, `encryption.js`).

## Frontend (`frontend/src`)

### App shell and routing

- `main.jsx`: React entrypoint + Sentry browser initialization + global error boundary.
- `App.jsx`: router configuration and route guards (`ProtectedRoute`, `AdminRoute`) for public vs authenticated pages.

### Pages (`pages/`)

- `Home.jsx`, `Pricing.jsx`, `Privacy.jsx`, `Terms.jsx`: marketing/legal/public content.
- `Login.jsx`: OAuth start/login state handling.
- `Dashboard.jsx`: primary product workspace (scan/cleanup flow, progress, quota, history, custom scans, automation playbooks).
- `Admin.jsx`: admin console.

### State/data and UI composition

- `hooks/`:
  - `useAuth.jsx`: auth context, session refresh/logout, user state.
  - `useScan.js`: scan lifecycle state/actions.
  - `useCleanup.js`: cleanup action state/actions.
- `api/client.js`: Axios client, token/cookie handling, and grouped API modules (`scanApi`, `cleanupApi`, `subscriptionApi`, `automationApi`).
- `components/`: modular UI building blocks (cards, progress/metrics, modals, quota banners, cleanup history, onboarding, playbooks panel, etc.).

## Chrome Extension (`extension/`)

- `manifest.json`: MV3 definition, permissions, host allowlist, and OAuth scopes.
- `background/service_worker.js`: background orchestration for extension auth and long-lived tasks.
- `popup/`: popup UI (`popup.html`, `popup.js`, `popup.css`) for user-triggered actions.

## Runtime Data Flow (high level)

1. User authenticates with Google from web app or extension flow.
2. Backend exchanges OAuth code, stores encrypted Gmail OAuth tokens, and issues app JWTs.
3. Frontend dashboard triggers scan/cleanup APIs.
4. Backend enqueues heavy work in jobs table.
5. Worker processes jobs, calls Gmail APIs, updates scan/cleanup records, and tracks quota/subscription constraints.
6. Frontend polls/refreshes state to render results, history, and actionable cleanup options.
