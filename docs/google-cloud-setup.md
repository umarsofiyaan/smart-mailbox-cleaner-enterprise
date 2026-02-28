# Google Cloud Console Setup Guide
## Smart Mailbox Cleaner — OAuth 2.0 Configuration

---

## Step 1: Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **New Project**
3. Name it: `Smart Mailbox Cleaner`
4. Click **Create**

---

## Step 2: Enable Required APIs

In your project, navigate to **APIs & Services > Library** and enable:

- **Gmail API** — required for reading and modifying emails
- **Google Drive API** — required for storage quota information
- **Google People API** (optional) — for user profile info; `oauth2` API is sufficient

---

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose **External** (for any Google account user)
3. Fill in:
   - **App name**: Smart Mailbox Cleaner
   - **User support email**: your@email.com
   - **App logo**: Upload your icon (optional)
   - **App domain**: `mailboxcleaner.umarsofiyaan.shop`
   - **Authorized domain**: `umarsofiyaan.shop`
   - **Developer contact email**: your@email.com

4. Click **Save and Continue**

### Scopes (Step 2 of consent screen)
Click **Add or Remove Scopes** and add:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/drive.metadata.readonly` (for quota)

Click **Save and Continue**

### Test Users (Step 3 — for testing before verification)
Add your Gmail test accounts here.

---

## Step 4: Create OAuth 2.0 Credentials

### Web Application Credentials (for backend + web dashboard)

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: `Smart Mailbox Cleaner Web`
5. **Authorized JavaScript origins**:
   ```
   https://app.mailboxcleaner.umarsofiyaan.shop
   http://localhost:5173
   ```
6. **Authorized redirect URIs**:
   ```
   https://api.mailboxcleaner.umarsofiyaan.shop/auth/google/callback
   http://localhost:3001/auth/google/callback
   ```
7. Click **Create**
8. Copy `Client ID` and `Client Secret` → add to backend `.env`

### Chrome Extension Credentials

1. Click **Create Credentials > OAuth 2.0 Client ID** again
2. Application type: **Chrome App**
3. Name: `Smart Mailbox Cleaner Extension`
4. **Application ID**: Your Chrome extension ID (found after uploading to Chrome Web Store)
   - During development: Find it at `chrome://extensions` → Enable Developer Mode → Load unpacked → Copy ID
5. Click **Create**
6. Copy the `Client ID` → add to `extension/manifest.json` in `oauth2.client_id`

---

## Step 5: App Verification (Required for Production)

Google requires verification for apps requesting sensitive scopes (`gmail.modify`).

**Required for verification:**
- Working OAuth consent screen with privacy policy URL
- App homepage with clear description
- Demo video showing app functionality (usually a short Loom)
- Privacy policy hosted at your domain (e.g., `https://mailboxcleaner.umarsofiyaan.shop/privacy`)

**Privacy policy must include:**
- What data is accessed (email metadata only, no content)
- What data is stored (none — only size and date metadata)
- How users can delete their data (GDPR endpoint)
- Contact information

**Timeline:** Verification typically takes 1-6 weeks.

**During verification (testing only):**
- Add test user emails in OAuth consent screen
- Up to 100 test users can use the app before verification

---

## Step 6: Copy Credentials to Environment Variables

Backend `.env`:
```
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://api.mailboxcleaner.umarsofiyaan.shop/auth/google/callback
```

Extension `manifest.json`:
```json
"oauth2": {
  "client_id": "your_chrome_extension_client_id.apps.googleusercontent.com",
  ...
}
```

---

## Troubleshooting

**"redirect_uri_mismatch" error:**
Ensure the exact redirect URI in your `.env` matches what's registered in Google Cloud Console (including `https://`, no trailing slash).

**"Access blocked: App not verified" for new users:**
Only test users (added in consent screen) can log in before verification. Add their emails.

**No refresh token received:**
This happens when a user has already authorized the app. The backend redirects to `/login?error=no_refresh_token`. User must:
1. Go to `myaccount.google.com/permissions`
2. Find and remove "Smart Mailbox Cleaner"
3. Sign in again → will receive a fresh refresh token

The `prompt: 'consent'` parameter in the auth URL forces re-consent for new sessions, which should prevent this in production.
