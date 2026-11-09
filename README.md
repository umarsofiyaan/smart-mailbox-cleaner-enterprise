<div align="center">

# 🧹 Smart Mailbox Cleaner — Enterprise Self-Hosted

**Deploy Gmail cleanup inside your own infrastructure. Zero data leakage.**

[![License](https://img.shields.io/badge/License-Enterprise-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](#)

[Website](https://smartmailboxcleaner.com) · [Enterprise Page](https://smartmailboxcleaner.com/enterprise/) · [Request Demo](mailto:enterprise@smartmailboxcleaner.com) · [Documentation](#deployment-guide)

</div>

---

## Why Self-Hosted?

Smart Mailbox Cleaner helps organizations **reclaim 30-50% of Gmail storage** across all employees by intelligently identifying and bulk-deleting old promotions, newsletters, social notifications, and large attachments — with a 30-day undo safety net.

The **Enterprise Self-Hosted Edition** runs entirely inside your infrastructure:

| Feature | Self-Hosted ✅ |
|---------|---------------|
| Data location | **Your servers — nothing leaves your network** |
| OAuth & Identity | **Your GCP project — seamless SSO via domain-wide consent** |
| Users | **Unlimited** |
| Cleanup credits | **Unlimited** |
| Domain restriction | **Your org domain only** |
| Compliance | **Full control — GDPR, SOC2, ISO 27001 ready** |

### Complete Data Sovereignty

Your IT admin sets up OAuth in **your own GCP project** and grants domain-wide consent — employees sign in seamlessly with their existing Google Workspace credentials. All email metadata stays within your infrastructure. No data ever touches external servers.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Your Infrastructure                      │
│                                                          │
│  ┌────────────┐    ┌────────────────┐    ┌────────────┐ │
│  │  Frontend   │───▶│    Backend     │───▶│ PostgreSQL │ │
│  │  (Nginx)    │    │  (Node.js 20)  │    │    16      │ │
│  │  Port 8080  │    │  API + Worker  │    │  Port 5432 │ │
│  │             │    │  Port 3001     │    │            │ │
│  └────────────┘    └───────┬────────┘    └────────────┘ │
│                            │                             │
└────────────────────────────┼─────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Google APIs    │
                    │  (Gmail, Drive) │
                    │  YOUR GCP       │
                    │  Project        │
                    └─────────────────┘
```

**Three containers. One command. ~15 minutes.**

- **Backend** — Node.js 20 Express API + background job worker (in-process). Handles OAuth, scanning, cleanup, automation playbooks, domain admin, and lifecycle emails.
- **Frontend** — React SPA pre-rendered to 240+ static HTML pages, served via Nginx with gzip and security headers.
- **Database** — PostgreSQL 16 with auto-migrations on startup. No ORM — raw SQL for performance.

---

## Features

### For Employees
- 🔍 **Smart Scan** — AI-powered categorization across 7 cleanup categories (Promotions, Social, Newsletters, Large Attachments, Updates, Forums, Aged Emails)
- 🗑️ **One-Click Bulk Delete** — Delete thousands of emails with confidence scoring (HIGH / MEDIUM / REVIEW)
- ↩️ **30-Day Undo** — Every deletion is reversible. Emails moved to trash, restorable with original labels
- 🔄 **Automation Playbooks** — Schedule recurring cleanup rules (daily, weekly, monthly) with dry-run simulation
- 📧 **Newsletter Manager** — Detect and batch-unsubscribe from marketing senders
- 📊 **Storage Dashboard** — Real-time storage gauge with growth rate tracking
- 🏷️ **Label Manager** — Organize, rename, merge, and bulk-apply Gmail labels
- 📥 **Import/Export** — Import .eml/.mbox files, export email archives

### For IT Admins
- 🏢 **Domain Admin Console** — Monitor aggregate storage trends across all employees
- 📋 **Data Retention Policies** — Enforce organization-wide cleanup playbooks
- 🔐 **Domain Restriction** — `WORKSPACE_DOMAIN_ALLOWLIST` limits sign-in to your org
- 📈 **Usage Analytics** — Track cleanup volume, storage savings, active users
- ♾️ **Unlimited Everything** — No per-user billing, no credit limits

### Free Gmail Tools (Included)
- 📧 [EML Reader](https://smartmailboxcleaner.com/tools/eml-reader/) — Open .eml files in browser
- 🔍 [Gmail Search Builder](https://smartmailboxcleaner.com/tools/gmail-search-builder/) — Visual search query builder
- 🔬 [Email Header Analyzer](https://smartmailboxcleaner.com/tools/email-header-analyzer/) — SPF/DKIM/DMARC analysis
- 📊 [Storage Calculator](https://smartmailboxcleaner.com/tools/gmail-storage-calculator/) — Estimate storage usage

---

## Deployment Guide

### Prerequisites

- **Docker** & **Docker Compose v2**
- **Enterprise License Key** — Contact [enterprise@smartmailboxcleaner.com](mailto:enterprise@smartmailboxcleaner.com) to get your license
- A **Google Cloud Platform** project with:
  - Gmail API enabled
  - Google Drive API enabled
  - OAuth 2.0 Client ID (Web application)
- A domain for the app (e.g., `mailclean.yourcompany.com`)
- SMTP credentials for email notifications (optional)

### Step 1: Clone & Configure

```bash
git clone https://github.com/umarsofiyaan/smart-mailbox-cleaner-enterprise.git
cd smart-mailbox-cleaner-enterprise

# Copy the config template
cp .env.example .env

# Generate security secrets
openssl rand -hex 64 | xargs -I{} echo "JWT_ACCESS_SECRET={}" >> .env
openssl rand -hex 64 | xargs -I{} echo "JWT_REFRESH_SECRET={}" >> .env
openssl rand -hex 32 | xargs -I{} echo "ENCRYPTION_KEY={}" >> .env
openssl rand -hex 32 | xargs -I{} echo "OAUTH_STATE_SECRET={}" >> .env
openssl rand -hex 24 | xargs -I{} echo "POSTGRES_PASSWORD={}" >> .env
```

### Step 2: Set Up Google OAuth

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Enable **Gmail API** and **Google Drive API** under "Enabled APIs"
4. Create **OAuth 2.0 Client ID** → Web application
5. Add authorized redirect URI:
   ```
   https://mailclean-api.yourcompany.com/auth/google/callback
   ```
6. Copy **Client ID** and **Client Secret** into `.env`:
   ```env
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret
   ```

#### Domain-Wide Consent (Recommended for Workspace)

For Google Workspace organizations, have your **Super Admin** grant domain-wide consent:

1. Go to [Admin Console → Security → API Controls → Domain-wide Delegation](https://admin.google.com/ac/owl/domainwidedelegation)
2. Add the OAuth Client ID
3. Grant scopes:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/drive.metadata.readonly
   ```

This eliminates the OAuth consent screen for all users in your domain.

### Step 3: Deploy

```bash
docker compose up -d
```

Expected output:
```
✔ Network smc-net          Created
✔ Container smc-db         Healthy
✔ Container smc-backend    Healthy
✔ Container smc-frontend   Started
```

### Step 4: Set Up Reverse Proxy (Production)

For production with TLS, configure your reverse proxy:

<details>
<summary><strong>Nginx</strong></summary>

```nginx
# Frontend
server {
    listen 443 ssl http2;
    server_name mailclean.yourcompany.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Backend API
server {
    listen 443 ssl http2;
    server_name mailclean-api.yourcompany.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 50m;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

</details>

<details>
<summary><strong>Caddy (auto-TLS)</strong></summary>

```
mailclean.yourcompany.com {
    reverse_proxy localhost:8080
}

mailclean-api.yourcompany.com {
    reverse_proxy localhost:3001
}
```

</details>

### Step 5: Verify

```bash
# Check all services
docker compose ps

# Backend health
curl http://localhost:3001/health

# Open in browser
open https://mailclean.yourcompany.com
```

---

## Configuration Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `FRONTEND_URL` | Public URL of the frontend | `https://mailclean.yourcompany.com` |
| `BACKEND_URL` | Public URL of the backend API | `https://mailclean-api.yourcompany.com` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from your GCP project | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret | `GOCSPX-xxx` |
| `JWT_ACCESS_SECRET` | JWT signing secret (64 hex bytes) | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | JWT refresh signing secret (64 hex bytes) | `openssl rand -hex 64` |
| `ENCRYPTION_KEY` | AES-256 encryption key (32 hex bytes) | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Database password | `openssl rand -hex 24` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKSPACE_DOMAIN_ALLOWLIST` | Comma-separated domains allowed to sign in | *(all domains)* |
| `COOKIE_DOMAIN` | Cookie domain scope | `.localhost` |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | SMTP for email notifications | *(disabled)* |
| `RESEND_API_KEY` | Resend.com API key (alternative to SMTP) | *(disabled)* |
| `SENTRY_DSN` | Sentry error tracking | *(disabled)* |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / etc. | S3-compatible storage for email exports | *(disabled)* |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payment gateway (leave empty = unlimited) | *(disabled)* |
| `FRONTEND_PORT` | Host port for frontend | `8080` |

---

## Operations

### Backups

```bash
# Backup database
docker exec smc-db pg_dump -U smartmailbox smartmailbox > backup_$(date +%Y%m%d).sql

# Restore from backup
docker exec -i smc-db psql -U smartmailbox smartmailbox < backup.sql
```

### Updating

```bash
docker compose pull        # Pull latest images
docker compose up -d       # Restart with new images
```

Migrations run automatically on startup — no manual steps needed.

### Monitoring

```bash
# Live logs
docker compose logs -f backend

# Database size
docker exec smc-db psql -U smartmailbox -c \
  "SELECT pg_size_pretty(pg_database_size('smartmailbox'));"

# Active users
docker exec smc-db psql -U smartmailbox -c \
  "SELECT COUNT(*) as active_users FROM users WHERE deleted_at IS NULL;"

# Storage savings
docker exec smc-db psql -U smartmailbox -c \
  "SELECT COUNT(*) as total_cleanups, SUM(emails_deleted) as emails_cleaned FROM cleanup_actions;"
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Backend won't start | Check `docker compose logs backend` — likely missing env vars |
| OAuth redirect error | Verify `GOOGLE_REDIRECT_URI` matches GCP console exactly |
| "unverified app" warning | Admin needs to grant domain-wide consent (see Step 2) |
| Database connection error | Ensure `smc-db` container is healthy: `docker compose ps` |
| Frontend shows blank page | Check browser console — likely `VITE_API_URL` mismatch |

---

## Security

- **OAuth tokens** encrypted with AES-256-GCM at rest
- **Passwords** hashed with bcrypt (cost factor 12)
- **JWT tokens** with short expiry (15min access, 30d refresh)
- **Helmet.js** security headers on all API responses
- **Rate limiting** on all endpoints (configurable)
- **Non-root** Docker containers
- **Health checks** on all services
- **No email content** is ever read — metadata only (sender, subject, size, date, labels)

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 1 core | 2 cores |
| RAM | 2 GB | 4 GB |
| Storage | 10 GB | 20 GB+ |
| Docker | v20+ | Latest |
| Docker Compose | v2.0+ | Latest |
| PostgreSQL | 14+ | 16 (included) |

Scales to **10,000+ users** on a single 4-core/8GB machine.

---

## Pricing

| Plan | Users | Support | Price |
|------|-------|---------|-------|
| **Pilot** | Up to 100 | Email | **Free (30 days)** |
| **Team** | Up to 500 | Email + Chat | Contact sales |
| **Enterprise** | Unlimited | Dedicated + SLA | Contact sales |

**[Request a 30-Day Free Pilot →](mailto:enterprise@smartmailboxcleaner.com?subject=Enterprise%20Self-Hosted%20—%2030-Day%20Pilot%20Request&body=Organization:%0ANumber%20of%20employees:%0AGoogle%20Workspace%20plan:%0A)**

---

## Links

- 🌐 [Website](https://smartmailboxcleaner.com)
- 🏢 [Enterprise Page](https://smartmailboxcleaner.com/enterprise/)
- 📧 [Contact Sales](mailto:enterprise@smartmailboxcleaner.com)
- 📖 [Blog](https://smartmailboxcleaner.com/blog/)
- 🔒 [Privacy Policy](https://smartmailboxcleaner.com/privacy-policy/)
- 📋 [Terms of Service](https://smartmailboxcleaner.com/terms-of-service/)

---

<div align="center">

**Built with ❤️ by [Smart Mailbox Cleaner](https://smartmailboxcleaner.com)**

*Privacy-first Gmail cleanup. Metadata only. Never reads your emails.*

</div>
