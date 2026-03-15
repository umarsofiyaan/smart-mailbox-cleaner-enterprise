# Google OAuth hardening checklist (Smart Mailbox Cleaner)

This document maps Google OAuth **Project Checkup** warnings to concrete actions in this app.

## 1) Use secure flows

### What Google expects
- `state` parameter on every OAuth auth request.
- PKCE (`S256`) for auth code flow.
- HTTPS redirect URI only.

### App status
- ✅ `state` is signed and validated server-side.
- ✅ PKCE is enabled (`code_challenge` + `code_verifier`).
- ✅ Redirect URI is backend HTTPS callback.

### Google Console checks
1. Go to **Google Auth Platform → Clients → Smart Mailbox Cleaner**.
2. Confirm redirect URI is exactly:
   - `https://api.smart-mailbox-cleaner.umarsofiyaan.shop/auth/google/callback`
3. Remove old/staging redirect URIs no longer used.

---

## 2) Incremental authorization

### What Google expects
- Request only needed scopes first.
- Ask additional scopes later when feature requires them.

### App strategy
- Default login asks for **core scopes**:
  - `gmail.readonly`
  - `gmail.modify`
  - `userinfo.email`
  - `userinfo.profile`
- Optional **storage** reconnect adds:
  - `drive.metadata.readonly`
- App uses `include_granted_scopes=true` and granular consent.

### Operator check
- If Project Checkup still shows warning, wait for Google telemetry to refresh (can take time).
- Perform one fresh login + one storage reconnect to generate compliant traffic.

---

## 3) Cross-Account Protection (RISC)

### What this is
RISC sends Google security events (e.g., account hijack / reset) to your backend.

### How to enable
1. Expose an HTTPS webhook endpoint in backend (recommended path: `/auth/google/risc`).
2. Verify Google-signed JWT assertions per RISC docs.
3. On valid critical events, revoke local refresh sessions and force re-login.
4. Register the webhook endpoint in Google Cloud OAuth security settings.

> Note: This repo currently focuses on OAuth login hardening + incremental scope flow. RISC endpoint integration can be added as a separate security feature rollout.

---

## 4) Verification and consent docs

In Google Cloud:
- **Branding**: app name, support email, logo, privacy-policy URL, terms URL.
- **Audience**: publish status and test users.
- **Data Access**: list only required scopes and provide justification.
- **Verification Center**: respond with exact feature-to-scope mapping from app pages.

---

## 5) Post-change smoke tests

1. Login from `/login` succeeds.
2. Callback does not fail with `invalid_state`.
3. Scan works.
4. Cleanup + undo works.
5. Storage card reconnect (`scope=storage`) grants Drive scope and live storage loads.
