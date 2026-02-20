# Smart Mailbox Cleaner

Production-ready Gmail cleanup SaaS with Chrome Extension.

**Live URLs:**
- App: https://app.mailboxcleaner.umarsofiyaan.shop
- API: https://api.mailboxcleaner.umarsofiyaan.shop

## Stack
- **Backend**: Node.js + Express + PostgreSQL (Supabase) on Render
- **Frontend**: React + Vite + TailwindCSS on Vercel
- **Extension**: Chrome MV3 standalone with own OAuth flow

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (or Supabase account)
- Google Cloud project with Gmail API enabled
- Stripe account

### Backend
```bash
cd backend
cp .env.example .env   # Fill in all values
npm install
node src/config/migrate.js   # Run DB migrations
npm run dev
```

### Frontend
```bash
cd frontend
cp .env.example .env.local   # Fill in values
npm install
npm run dev
```

### Chrome Extension
1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `extension/` folder

## Documentation
- [Google Cloud Setup](docs/google-cloud-setup.md)
- [Deployment Guide](docs/deployment.md)
- [Security Checklist & Scaling Plan](docs/security-checklist.md)

## Security
- Email body content is **never** read or stored
- All cleanups move to Trash (never permanent delete)
- Undo available for 30 days
- AES-256-GCM encrypted OAuth token storage
- JWT access tokens expire in 15 minutes with rotation
