# Smart Mailbox Cleaner

A full-stack application for analyzing and cleaning up Gmail mailboxes.

## Architecture

- **Frontend**: React + Vite (hosted on Cloudflare Pages)
- **Backend**: Node.js/Express (hosted on Render or Railway)
- **Database**: PostgreSQL

## Deployment

### Backend (Render)

1. Go to https://render.com
2. Create new Web Service
3. Connect GitHub repo
4. Set build command: `cd backend && npm install`
5. Set start command: `cd backend && node src/app.js`
6. Add environment variables:
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
   - `ENCRYPTION_KEY`
   - All other vars from `.env`

### Frontend (Cloudflare Pages)

1. Go to https://dash.cloudflare.com → Pages
2. Connect GitHub repo
3. Set build command: `cd frontend && npm run build`
4. Set build output: `frontend/dist`
5. Add environment variables:
   - `VITE_API_URL`: Your Render backend URL
   - `VITE_STRIPE_PUBLISHABLE_KEY`
   - `VITE_APP_URL`: Your Cloudflare Pages domain

### Database

Use PostgreSQL on:
- Render (free tier, sleeps after 15 mins idle)
- Railway (free credits)
- Supabase (PostgreSQL hosting)

## Local Development

```bash
docker compose up
```

Frontend: http://localhost:5173
Backend: http://localhost:3001

## Disabled Features for Testing

- `BYPASS_PRO=true` in production is disabled
- Real subscription checks are enforced
- Enable Stripe for payment processing
