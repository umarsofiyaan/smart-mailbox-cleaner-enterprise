# Security Checklist & Scaling Plan
## Smart Mailbox Cleaner

---

## Security Checklist

### Authentication & Tokens
- [x] JWT access tokens expire in 15 minutes
- [x] Refresh tokens rotated on every use (reuse detected → all sessions revoked)
- [x] Google OAuth refresh tokens encrypted with AES-256-GCM before DB storage
- [x] Refresh token hashes stored for rotation tracking (not plaintext)
- [x] HttpOnly cookies for web dashboard (immune to XSS theft)
- [x] Chrome extension uses `chrome.storage.local` (sandboxed per extension)
- [x] `prompt: 'consent'` forces re-consent to always receive refresh tokens
- [x] Token expiry checked on every authenticated request

### API Security
- [x] Helmet middleware: CSP, HSTS (1yr), X-Frame-Options, X-Content-Type-Options
- [x] CORS restricted to extension Chrome ID + app subdomain only
- [x] Rate limiting on all routes (tiered by sensitivity)
- [x] All API endpoints require JWT verification middleware
- [x] Pro subscription enforced at middleware level (not just frontend)
- [x] Stripe webhook signature verified with `constructEvent()` before any processing
- [x] Raw body preserved for Stripe webhook route (before JSON parser)
- [x] Input validation with express-validator on all mutation endpoints
- [x] `trust proxy` set for accurate IP detection behind Render/Railway

### Data Security
- [x] Email body content NEVER fetched, stored, or logged
- [x] Only metadata accessed: messageId, threadId, labelIds, sizeEstimate, internalDate, headers subset
- [x] Logger sanitizes all sensitive field names before output
- [x] Encryption key stored as environment variable, never in code
- [x] Database connection uses SSL (DB_SSL=true)
- [x] No SQL injection risk (parameterized queries throughout)
- [x] GDPR delete-account endpoint: cascading DB delete + token revocation

### Infrastructure
- [x] All traffic over HTTPS (enforced by Render/Vercel + HSTS)
- [x] Environment variables for all secrets (no hardcoded values)
- [x] Production error messages sanitized (no stack traces exposed)
- [x] Graceful shutdown on SIGTERM
- [x] Unhandled rejection logging without crashing

---

## Known Limitations

1. **Background worker is in-process**: The job queue worker runs inside the Express process. At scale (>500 concurrent users), this should be extracted to a separate worker service. Redis + BullMQ is the recommended upgrade path.

2. **No email deduplication on free tier**: Duplicate detection is Pro-only and not implemented in MVP. First version uses subject+sender fuzzy matching (add in Phase 2).

3. **Scan depth for large mailboxes**: At 50k+ emails, even the 12-month scan may take 3-5 minutes due to Gmail API rate limits. This is expected. The paged progressive approach handles it gracefully.

4. **Gmail API quota**: Gmail API has a default quota of 250 quota units/second/user and 1 billion quota units/day. Each `messages.list` call costs 5 units; `messages.get` costs 5 units. At 2000 messages per scan with metadata-only fetching, a full scan uses ~10,000-20,000 quota units — well within limits.

5. **Storage calculation requires 2 scans**: Daily growth rate and "days until full" can only be calculated after the user has run at least 2 scans (to establish a baseline delta).

6. **Chrome extension manual update**: Extension manifest has the API URL hardcoded. If the API URL changes, a new extension version must be submitted to the Chrome Web Store.

7. **OAuth verification**: Google requires app verification for apps requesting `gmail.modify`. During the verification period (1-6 weeks), only manually added test users can use the app.

---

## Scaling Plan (10,000 Users)

### Current Architecture Limits
The MVP architecture comfortably supports ~500 concurrent users on a single Render instance.

### 1,000 → 10,000 Users: Upgrade Path

#### Database
- Upgrade Supabase to **Pro plan** (dedicated compute, connection pooling via PgBouncer)
- Add read replica for scan result queries
- Add indexes: `scans(user_id, status, completed_at)` composite index

#### Background Jobs
- Extract in-process worker → **dedicated worker Render service**
- Or migrate to **Redis + BullMQ** for distributed job queue
- Add job deduplication to prevent duplicate scans for same user

#### API
- Enable **horizontal scaling** on Render (multiple instances)
- JWT is stateless — scales without shared session state
- Add **connection pooling** (PgBouncer on Supabase Pro)
- Add **Redis cache** for frequently read data (scan results, subscription status)
- Cache TTL: subscription status 5min, completed scan results 30min

#### Gmail API
- Request increased Gmail API quota from Google Cloud Console
- Default quota is sufficient for ~10,000 daily active users at 1 scan/week each
- Monitor quota usage in Google Cloud Console dashboard

#### CDN & Frontend
- Vercel handles global CDN automatically — no changes needed at 10k users
- Enable Vercel Edge Functions if sub-50ms response time is required

#### Monitoring (add at 1,000 users)
- **Sentry**: error tracking and alerting
- **Datadog or Grafana Cloud**: API latency, DB query times, job queue depth
- Alert thresholds: p95 API latency >2s, error rate >1%, job queue depth >100

#### Cost Estimate at 10,000 Users
| Service | Plan | Monthly Cost |
|---------|------|-------------|
| Render (API + Worker) | Standard × 2 | ~$28 |
| Supabase | Pro | $25 |
| Vercel | Pro | $20 |
| Total | | ~$73/mo |

At $5/month Pro revenue: 15 Pro subscribers covers infrastructure costs.
At 10% conversion rate: 1,000 Pro users = $5,000/mo revenue.
