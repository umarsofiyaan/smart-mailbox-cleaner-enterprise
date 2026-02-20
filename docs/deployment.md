# Deployment Guide
## Smart Mailbox Cleaner — Production Deployment

---

## Architecture
- **Backend API**: Render (Node.js)
- **Database**: Supabase (PostgreSQL)
- **Frontend**: Vercel (React/Vite)
- **Domains**:
  - API: `api.mailboxcleaner.umarsofiyaan.shop`
  - App: `app.mailboxcleaner.umarsofiyaan.shop`

---

## Phase 1: Database Setup (Supabase)

1. Create account at [supabase.com](https://supabase.com)
2. Click **New Project**
   - Name: `smart-mailbox-cleaner`
   - Database password: use a strong generated password
   - Region: choose closest to your users
3. Once created, go to **Settings > Database**
4. Copy the **Connection String** (use "Transaction" mode if using connection pooling)
5. Go to **Settings > API** and note your project URL
6. Run migrations:
   ```bash
   cd backend
   cp .env.example .env
   # Fill in DATABASE_URL from Supabase
   npm install
   node src/config/migrate.js
   ```
7. Verify tables created in Supabase **Table Editor**

---

## Phase 2: Stripe Setup

1. Create account at [dashboard.stripe.com](https://dashboard.stripe.com)
2. Create a product:
   - Go to **Products > Add Product**
   - Name: `Smart Mailbox Cleaner Pro`
   - Pricing: $5.00/month, recurring
   - Copy the **Price ID** (starts with `price_`)
3. Copy your API keys from **Developers > API keys**:
   - Publishable key: `pk_live_...`
   - Secret key: `sk_live_...`
4. Set up webhook (after Render deployment):
   - Go to **Developers > Webhooks > Add Endpoint**
   - URL: `https://api.mailboxcleaner.umarsofiyaan.shop/subscription/webhook`
   - Events to send:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
     - `invoice.payment_succeeded`
   - Copy **Signing Secret** → `STRIPE_WEBHOOK_SECRET`

---

## Phase 3: Backend on Render

1. Push code to GitHub: `git push origin main`
2. Go to [render.com](https://render.com) → **New > Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `smart-mailbox-cleaner-api`
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `node src/app.js`
   - **Environment**: Node
   - **Plan**: Starter ($7/mo) or free for testing

5. Add all environment variables from `backend/.env.example`:

   ```
   NODE_ENV=production
   PORT=3001
   FRONTEND_URL=https://app.mailboxcleaner.umarsofiyaan.shop
   BACKEND_URL=https://api.mailboxcleaner.umarsofiyaan.shop
   DATABASE_URL=postgresql://...  (from Supabase)
   DB_SSL=true
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://api.mailboxcleaner.umarsofiyaan.shop/auth/google/callback
   JWT_ACCESS_SECRET=...  (generate: openssl rand -hex 64)
   JWT_REFRESH_SECRET=...  (generate: openssl rand -hex 64)
   ENCRYPTION_KEY=...  (generate: openssl rand -hex 32)
   STRIPE_SECRET_KEY=...
   STRIPE_WEBHOOK_SECRET=...
   STRIPE_PRO_PRICE_ID=price_...
   EXTENSION_ID=...  (your Chrome extension ID)
   ```

6. Click **Create Web Service**
7. Note the Render URL (e.g., `https://smart-mailbox-cleaner-api.onrender.com`)

### Custom Domain on Render
1. Go to your service → **Settings > Custom Domains**
2. Add: `api.mailboxcleaner.umarsofiyaan.shop`
3. Add the CNAME record to your domain DNS:
   - Type: CNAME
   - Name: `api.mailboxcleaner`
   - Value: `smart-mailbox-cleaner-api.onrender.com`
4. Wait for DNS propagation (5-30 min)
5. Render will auto-provision SSL via Let's Encrypt

---

## Phase 4: Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repository
3. Configure:
   - **Framework**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

4. Add environment variables:
   ```
   VITE_API_URL=https://api.mailboxcleaner.umarsofiyaan.shop
   VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
   VITE_APP_URL=https://app.mailboxcleaner.umarsofiyaan.shop
   ```

5. Click **Deploy**

### Custom Domain on Vercel
1. Go to **Settings > Domains**
2. Add: `app.mailboxcleaner.umarsofiyaan.shop`
3. Add CNAME record to DNS:
   - Type: CNAME
   - Name: `app.mailboxcleaner`
   - Value: `cname.vercel-dns.com`

---

## Phase 5: Chrome Extension

### Development testing
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/` folder
4. Note the Extension ID displayed — add to backend `EXTENSION_ID` env var

### Production submission
1. Create icons (16x16, 48x48, 128x128 PNG) in `extension/icons/`
2. Zip the `extension/` directory:
   ```bash
   cd smart-mailbox-cleaner
   zip -r extension.zip extension/
   ```
3. Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
4. Pay the one-time $5 developer fee
5. Click **New Item** → upload `extension.zip`
6. Fill in store listing details, screenshots, description
7. Submit for review (typically 1-3 business days)
8. Once published, update `EXTENSION_ID` in backend env and `manifest.json`

---

## Post-Deployment Checklist

- [ ] Health check: `curl https://api.mailboxcleaner.umarsofiyaan.shop/health`
- [ ] OAuth flow: sign in via `https://app.mailboxcleaner.umarsofiyaan.shop/login`
- [ ] Run a test scan
- [ ] Test Stripe checkout with test card `4242 4242 4242 4242`
- [ ] Test webhook via Stripe CLI: `stripe trigger checkout.session.completed`
- [ ] Confirm GDPR delete endpoint works
- [ ] Check Render logs for any startup errors

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env
# Fill in env vars (use local DB or Supabase with test project)
npm install
node src/config/migrate.js   # Run migrations
npm run dev                  # Starts on port 3001

# Frontend
cd frontend
cp .env.example .env.local
# Set VITE_API_URL=http://localhost:3001
npm install
npm run dev                  # Starts on port 5173

# Extension
# In Chrome: load unpacked from extension/ directory
# Set API_URL in service_worker.js and APP_URL to http://localhost:5173 for dev
```
