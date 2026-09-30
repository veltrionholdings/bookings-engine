# Tas Hair — Go-Live Checklist

Everything below is intentionally **not done during UAT** because each step is
either commercial (needs the client's sign-off / payment) or client-facing (turns
on real customer traffic). Work through this once the client has approved the app
and the commercials are agreed.

Order matters — the steps are listed in the sequence to execute them.

Reference values (current):
- Tenant slug: `tas-hair` · Tenant ID: `da8e5df8-f070-4671-a176-590a76c574b2`
- API: `https://hdh82zlkzb.execute-api.eu-west-1.amazonaws.com/v1`
- App (current Vercel prod): `https://tas-hair-app.vercel.app`
- Cognito user pool: `eu-west-1_kzwL1VhJr` · app client: `m535i5660f5harvfu6fou0cu9`
- Cognito Hosted UI domain: `tas-hair-auth.auth.eu-west-1.amazoncognito.com`
- DB secret ARN: `arn:aws:secretsmanager:eu-west-1:610356898095:secret:bookings-engine/db-credentials-vrVG7u`
- Region: `eu-west-1`

---

## 0. Commercial sign-off (before anything technical)

- [ ] Setup fee and monthly fee agreed and invoiced
- [ ] Domain cost + who owns/pays for the domain agreed
- [ ] Client has approved the app from UAT (feedback actioned)
- [ ] Confirm the client's desired public web address for the app
- [ ] Confirm the client's desired sending address (e.g. `bookings@tashair.co.za`)

---

## 1. Domain (foundation for both email and the app address)

The client needs a domain for genuine white-label email and a branded app URL.

- [ ] Register the domain (e.g. `tashair.co.za`) — decide owner (client vs. Veltrion-managed)
- [ ] Confirm you have access to the domain's **DNS** (registrar or Route 53)

> Everything in sections 2 and 4 depends on being able to add DNS records.

---

## 2. Email deliverability (AWS SES)

Goal: emails send from the client's own domain and reach real customers' inboxes.

### 2a. Verify the domain in SES
- [ ] SES console (eu-west-1) → Verified identities → Create identity → Domain → `tashair.co.za`
- [ ] Enable **Easy DKIM** (SES generates 3 CNAME records)
- [ ] Add the **DKIM CNAME records** to the domain's DNS
- [ ] Add an **SPF** record (TXT: `v=spf1 include:amazonses.com ~all`)
- [ ] Add a **DMARC** record (TXT on `_dmarc`: `v=DMARC1; p=none; rua=mailto:postmaster@tashair.co.za`)
- [ ] Wait for SES to show the domain **Verified** (minutes to a few hours)

### 2b. Exit the SES sandbox (production access)
Currently the account is in the **sandbox** (`ProductionAccess: false`), so email
only reaches verified addresses. This must be lifted for real customers.

- [ ] SES console → Account dashboard → **Request production access**
- [ ] Mail type: **Transactional**
- [ ] Website URL: the live app URL
- [ ] Use-case description (suggested wording):
  > Veltrion operates a multi-tenant booking platform for service businesses. We
  > send transactional emails only — booking confirmations, cancellations,
  > reschedules and no-show notices — triggered when a customer books or changes an
  > appointment. Recipients have explicitly booked and provided their email. Every
  > email identifies the sender and includes business contact details. Expected
  > volume is low (under a few hundred per day). We log and suppress repeat bounces.
- [ ] Submit; approval is usually within ~24h
- [ ] After approval, confirm `ProductionAccess: true`:
  `aws sesv2 get-account --region eu-west-1 --query ProductionAccessEnabled`

### 2c. Point the tenant at their own sender
- [ ] Set the tenant's email settings to the real domain address. Using the script
  (with DB_* env vars sourced from the secret, as in the migration runbook):
  ```powershell
  $env:TENANT_SLUG='tas-hair'
  $env:EMAIL_FROM_NAME='Tas Hair & Beauty Cafe'
  $env:EMAIL_FROM='bookings@tashair.co.za'
  $env:EMAIL_REPLY_TO='bookings@tashair.co.za'
  $env:EMAIL_BUSINESS_ADDR='271/206 Block IA, Soshanguve'
  $env:EMAIL_BUSINESS_PHONE='078 878 2527'
  $env:EMAIL_LOGO_URL='https://<final-app-domain>/logo-full.png'
  $env:EMAIL_SHOW_PLATFORM_FOOTER='false'   # true white-label: drop "via Veltrion"
  npx ts-node scripts/set-tas-email-settings.ts
  ```
- [ ] Remove the temporary test identities from SES if desired
  (`veltrionholdings@gmail.com`, `rontsotetsi@gmail.com`, `tasmotswako@gmail.com`)
- [ ] Send a real test booking to a non-verified external address to confirm delivery
  now works (only valid after sandbox exit)

---

## 3. Google sign-in (optional client-facing feature)

Full instructions already exist in **`docs/google-login-setup.md`**. Summary:

- [ ] Create Google OAuth credentials (Google Cloud Console)
- [ ] Authorized redirect URI: `https://tas-hair-auth.auth.eu-west-1.amazoncognito.com/oauth2/idpresponse`
- [ ] Deploy the stack with the Google context values:
  ```powershell
  npx cdk deploy -c googleClientId=... -c googleClientSecret=... `
    -c oauthCallbackUrls="https://<final-app-domain>/auth/callback" `
    -c oauthLogoutUrls="https://<final-app-domain>/login" --require-approval never
  ```
- [ ] Set `VITE_COGNITO_DOMAIN` on Vercel and redeploy the frontend
- [ ] Confirm the "Continue with Google" button appears and completes a login

> Apple sign-in is deferred (requires the paid Apple Developer account).

---

## 4. App web address (Vercel production domain)

- [ ] Add the client's domain (or subdomain, e.g. `book.tashair.co.za`) to the
  Vercel project → Domains
- [ ] Add the DNS record Vercel provides (CNAME/A) at the registrar
- [ ] Confirm the app loads at the new address over HTTPS
- [ ] Update anywhere the app URL is referenced:
  - Vercel env `VITE_COGNITO_REDIRECT_URI` (if used)
  - Cognito callback/logout URLs (redeploy stack context if changed)
  - The tenant's `EMAIL_LOGO_URL` (section 2c) to the final domain
- [ ] Confirm **Deployment Protection** is OFF for production (so customers can reach it)

---

## 5. Data & content final pass

- [ ] Confirm the **service menu** is correct (names, prices, and set real
  **durations** per service — they currently all default to 60 min)
- [ ] Confirm **stylists** and their **working hours** are correct
- [ ] Confirm which services each stylist offers (once there's more than one)
- [ ] Rotate/replace the **test accounts**: change the `admin@tashair.test` password
  (or create the owner's real admin account) and remove test staff/customers as needed
- [ ] Confirm the **marketing-consent** wording matches the client's POPIA stance

---

## 6. Platform hygiene (recommended before / around go-live)

- [ ] **Fix CI auto-deploy** — the GitHub Actions `deploy.yml` isn't deploying on
  push (backend has needed manual `cdk deploy` this cycle). Fix so deploys are
  automatic, or document the manual deploy as the process.
- [ ] Confirm **RDS automated backups** are on (see Backup_And_Disaster_Recovery.md)
- [ ] Confirm **billing alerts** are set (see Cost_Management.md)
- [ ] Consider moving Google client secret into SSM / GitHub secrets so the deploy
  workflow can pass it automatically (see note in google-login-setup.md)

---

## 7. Go-live smoke test (after all of the above)

- [ ] Register a brand-new customer account (real external email) → verification email arrives
- [ ] Make a booking → confirmation email arrives, from the client's domain, with logo
- [ ] Cancel it → cancellation email arrives
- [ ] Admin reschedules a booking → reschedule email arrives
- [ ] "Continue with Google" completes a sign-in (if enabled)
- [ ] App loads on the client's domain on both phone and desktop
- [ ] Hand over admin credentials to the client and confirm they can sign in

---

## What's already done (no action needed at go-live)

- Real Tas Hair logo across app icons, header, spinner, and emails
- PWA install prompts (Android / iOS / Huawei)
- Branded loading states
- Email verification + resend on registration
- POPIA marketing consent (DB columns live, capture + profile toggle)
- 30-service categorised menu (live in DB)
- Per-tenant white-label email (sender, branding, logo, footer toggle) — code live
- Google sign-in — code live and deployed, gated dark until section 3 config
