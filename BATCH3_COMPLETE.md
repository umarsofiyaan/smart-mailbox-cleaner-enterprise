## Batch 3: Admin Portal + Free-Tier Quota System - COMPLETED ✅

### Summary of Implementation

All Batch 3 code has been created and integrated. This adds:
1. **Admin Portal** (`/admin` page) for managing users and quotas
2. **Free-Tier Quota System** (500 lifetime + 50/day) for non-Pro users
3. **Quota Banner** in Dashboard showing remaining quota
4. **Quota enforcement** on cleanup execution

---

## Files Created

### Backend

1. **`backend/src/services/quotaService.js`** (NEW)
   - `getQuota(userId)` - Get or create quota record
   - `grantDailyQuotaOnLogin(userId)` - Grant 50/day quota on login (call on every login)
   - `checkQuota(userId)` - Check if cleanup allowed + remaining
   - `consumeQuota(userId, emailCount)` - Deduct quota after cleanup
   - `getQuotaSummary(userId)` - For frontend display
   - `adminSetQuota(userId, {values})` - Admin override

2. **`backend/src/routes/admin.js`** (Already copied in Batch 3 start)
   - GET `/admin/users` - List all users (with search & pagination)
   - GET `/admin/users/:userId` - Get single user detail
   - PATCH `/admin/users/:userId/subscription` - Flip plan Free ↔ Pro
   - PATCH `/admin/users/:userId/quota` - Adjust lifetime/daily quotas
   - DELETE `/admin/users/:userId` - Delete user account
   - GET `/admin/stats` - Dashboard stats (users, Pro count, scans, space freed)

### Backend Updates

3. **`backend/src/routes/cleanup.js`** (UPDATED)
   - POST `/cleanup/execute` - Now checks quota before executing
   - GET `/cleanup/quota` - NEW endpoint for QuotaBanner component
   - Caps cleanup count to quota remaining
   - Calls `consumeQuota()` after successful cleanup

4. **`backend/src/routes/auth.js`** (UPDATED)
   - GET `/auth/google/callback` - Calls `grantDailyQuotaOnLogin()` on signup
   - POST `/auth/refresh` - Calls `grantDailyQuotaOnLogin()` on token refresh (ensures daily reset works)

### Frontend

5. **`frontend/src/pages/Admin.jsx`** (NEW)
   - Admin dashboard showing 4 stat cards (users, pro subs, scans, space freed)
   - User table with search & pagination
   - Inline quota editor (lifetime/daily allowance)
   - Plan flipper button (Free ↔ Pro)
   - Delete user button
   - Protected to is_admin users only

6. **`frontend/src/components/QuotaBanner.jsx`** (NEW)
   - Shows quota usage bars for free users
   - Displays lifetime + daily progress
   - Shows "exhausted" warning with upgrade link
   - Only visible for non-Pro users

### Frontend Updates

7. **`frontend/src/pages/Dashboard.jsx`** (UPDATED)
   - Added import for `QuotaBanner`
   - Added `<QuotaBanner isPro={isPro} />` after progress bar
   - Updated profile menu to include "Admin Dashboard" button

8. **`frontend/src/App.jsx`** (UPDATED)
   - Added import for `Admin.jsx`
   - Added `AdminRoute` component (auth wrapper)
   - Added `/admin` route: `<Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />`

9. **`frontend/src/api/client.js`** (UPDATED)
   - Added `cleanupApi.getQuota()` helper for QuotaBanner

---

## Database Migration Required

**File**: `BATCH3_MIGRATION.sql` (created for reference)

Run this in Supabase SQL Editor **before deploying**:

```sql
-- Add admin flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Create quota table
CREATE TABLE IF NOT EXISTS user_quota (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  lifetime_allowance INTEGER NOT NULL DEFAULT 500,
  lifetime_used INTEGER NOT NULL DEFAULT 0,
  daily_allowance INTEGER NOT NULL DEFAULT 50,
  daily_used INTEGER NOT NULL DEFAULT 0,
  daily_quota_granted_at TIMESTAMPTZ,
  daily_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_quota_user_id ON user_quota(user_id);
```

Then make yourself admin:
```sql
UPDATE users SET is_admin = TRUE WHERE email = 'your-email@gmail.com';
```

---

## Feature Details

### Admin Portal (`/admin`)

**Access**: Only users with `is_admin = TRUE` can access

**Stats Dashboard**:
- Total Users
- Pro Subscribers (active, plan='pro')
- Total Scans
- Total Space Freed (sum of bytes)

**User Management**:
- Search by email or name
- Pagination (50 users per page)
- For each user see:
  - Email, display name, avatar
  - Current plan + subscription status
  - Quota status (lifetime/daily usage)
  - Stats (scan count, cleanup count)
- Actions per user:
  - **Edit Quota**: Inline editor for lifetime_allowance, lifetime_used, daily_allowance
  - **Flip Plan**: Flip between Free and Pro (Pro = +30 days)
  - **Delete User**: Permanently delete account + all data

### Free-Tier Quota System

**Rules**:
- **Pro users**: Bypass all quota checks (unlimited)
- **Free users**: Start with 500 emails lifetime
- Once 500 used: 50 emails/day quota kicks in
- Daily quota resets at midnight UTC
- Daily quota only granted **once per login** (safe to call multiple times)

**When quota is checked**:
- On cleanup execution (POST `/cleanup/execute`)
- Returns 403 with error: "Free quota exhausted. Upgrade to Pro for unlimited cleanup."

**When quota is deducted**:
- After cleanup succeeds (daily first, then lifetime)
- Never deducted on failures

**Frontend display**:
- QuotaBanner shows lifetime + daily bars
- Only visible for non-Pro users
- Shows "exhausted" state with upgrade link
- Updates on component mount (lazy-loaded)

---

## How to Deploy

### 1. Database Migration (First)
Open Supabase SQL Editor → Run `BATCH3_MIGRATION.sql` → Make yourself admin

### 2. Push Code to GitHub
```bash
cd /path/to/smart-mailbox-cleaner
git add -A
git commit -m "Batch 3: Admin portal and free-tier quota system"
git push origin main
```

### 3. Auto-Deploy
- **Backend** (Render): Automatically deploys on git push (2-3 min)
- **Frontend** (Cloudflare Pages): Automatically deploys on git push (2-3 min)

### 4. Test Locally (Before push)
- Start backend: `npm start` in `backend/`
- Start frontend: `npm run dev` in `frontend/`
- Sign in with a free account
- Verify QuotaBanner shows 500/500 lifetime
- Attempt cleanup (should work for first 500)
- Check Admin dashboard at `/admin` (should show error if not admin)
- Make yourself admin in DB, then `/admin` should work

---

## Key Implementation Notes

### quotaService.js
- **grantDailyQuotaOnLogin()**: Only grants if (1) free user, (2) lifetime exhausted, (3) today is new day
- Safe to call multiple times per login
- Called in both `/auth/google/callback` and `/auth/refresh`
- Does NOT throw — non-critical, logs only
- Uses UTC midnight for consistency

### Admin.jsx
- Checks `is_admin` in Admin.jsx component (not in middleware)
- Admin portal redirects if unauthorized (could add middleware later)
- Inline quota editing with save/cancel
- Plan flipper sets `current_period_end = NOW() + 30 days`

### QuotaBanner.jsx
- Only renders if NOT Pro
- Fetches quota on mount via `cleanupApi.getQuota()`
- Shows bars: lifetime first, daily only if lifetime exhausted
- Red state = exhausted, amber state = warning

### Cleanup enforcement
- Checks quota before cleanup (returns 403 if exhausted)
- Caps email count to quota remaining (soft limit)
- Deducts from daily first, then lifetime (post-cleanup)
- Returns `quotaRemaining` in response

---

## File Structure Summary

```
backend/
├── src/
│   ├── services/
│   │   └── quotaService.js ✅ NEW
│   ├── routes/
│   │   ├── admin.js ✅ (copied in Batch 3 start)
│   │   └── cleanup.js ✅ UPDATED (quota checks + GET /cleanup/quota)
│   │   └── auth.js ✅ UPDATED (grantDailyQuotaOnLogin calls)
│   └── config/
│       └── migrate.js ✅ (contains schema, no change needed)

frontend/
├── src/
│   ├── pages/
│   │   ├── Admin.jsx ✅ NEW
│   │   ├── Dashboard.jsx ✅ UPDATED (QuotaBanner + admin button)
│   │   └── App.jsx ✅ UPDATED (/admin route)
│   ├── components/
│   │   └── QuotaBanner.jsx ✅ NEW
│   └── api/
│       └── client.js ✅ UPDATED (cleanupApi.getQuota)

BATCH3_MIGRATION.sql ✅ (reference for DB setup)
```

---

## Batch 3 Complete! ✅

All files are in place and ready to deploy. Next steps:
1. Run SQL migration in Supabase
2. Push to GitHub
3. Wait 2-3 min for auto-deploy
4. Test admin portal and quota system
5. Monitor logs for any issues

All three batches (Core Fixes, UX Enhancements, Admin+Quota) are now complete and can be deployed together.
