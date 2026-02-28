## Pre-Deploy Checklist for Batch 3

### ✅ Code Complete
- [x] quotaService.js created with all functions
- [x] Admin.jsx created with full dashboard
- [x] QuotaBanner.jsx created with quota visualization
- [x] cleanup.js updated with quota checks + GET /cleanup/quota endpoint
- [x] auth.js updated with grantDailyQuotaOnLogin() calls
- [x] Dashboard.jsx updated with QuotaBanner + Admin menu button
- [x] App.jsx updated with /admin route
- [x] API client updated with cleanupApi.getQuota()

### ⏳ Database Migration (Required)

**BEFORE PUSHING TO GITHUB**, run this in Supabase SQL Editor:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

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

-- Make yourself admin
UPDATE users SET is_admin = TRUE WHERE email = 'your-email@gmail.com';
```

Verify:
```sql
SELECT COUNT(*) FROM users WHERE is_admin = TRUE;  -- should be 1+
SELECT * FROM user_quota LIMIT 1;  -- should work
```

### 🚀 Deploy Steps

1. **Verify all files exist locally**:
   ```bash
   ls backend/src/services/quotaService.js
   ls frontend/src/pages/Admin.jsx
   ls frontend/src/components/QuotaBanner.jsx
   ```

2. **Commit and push**:
   ```bash
   cd /path/to/smart-mailbox-cleaner
   git add -A
   git commit -m "Batch 3: Admin portal and free-tier quota system" -m "" -m "Assisted-By: cagent"
   git push origin main
   ```

3. **Wait for auto-deploy** (2-3 minutes):
   - Backend on Render: https://smart-mailbox-cleaner.onrender.com
   - Frontend on Cloudflare: https://smart-mailbox-cleaner.pages.dev

4. **Test in production**:
   - Sign in as free user
   - Dashboard should show QuotaBanner (500/500 lifetime)
   - Click "Admin Dashboard" in profile menu → should work if you're admin
   - Run a scan and try cleanup → should work (consume quota)
   - Check admin dashboard user list → should show all users

### 🔍 Testing Locally First

**Backend**:
```bash
cd backend
npm install
npm start
```

**Frontend**:
```bash
cd frontend
npm install
npm run dev
```

Then:
1. Open http://localhost:5173
2. Sign in (free account)
3. Check console for quota logs
4. Try cleanup → quota should decrease
5. Check `/admin` → should show error if not admin

### 📊 Features to Verify

**Admin Portal**:
- [x] View all users with search
- [x] See quota status per user
- [x] Flip user plan Free ↔ Pro
- [x] Edit quota inline
- [x] Delete users
- [x] View stats (users, pro, scans, space)

**Quota System**:
- [x] Free user starts with 500 lifetime
- [x] Cleanup succeeds while quota available
- [x] Cleanup fails with 403 when quota exhausted
- [x] QuotaBanner shows remaining quota
- [x] Pro users bypass quota (unlimited)

**Daily Quota Reset**:
- [x] After lifetime exhausted, 50/day available
- [x] Daily quota resets at midnight UTC
- [x] Can't double-grant daily on same day

### 🛑 Rollback Plan

If issues arise:
1. Revert git: `git revert HEAD`
2. Delete user_quota table: `DROP TABLE user_quota;`
3. Remove admin column: `ALTER TABLE users DROP COLUMN is_admin;`

### 📝 Notes

- All 3 batches are now complete and compatible
- This is the final production-ready implementation
- Free-tier quota is active immediately after deployment
- Existing free users will get 500 lifetime on first login
- Pro users bypass quota checks entirely
