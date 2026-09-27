# Google Sign-In Setup (Cognito Hosted UI)

This guide covers everything needed to turn on "Continue with Google" for the Tas
Hair app. The code is already in place — this is the one-time console + deploy
configuration. Until it's done, the Google button stays hidden, so nothing breaks
in the meantime.

There are four parts, in order:

1. Create Google OAuth credentials (Google Cloud Console)
2. Deploy the backend with those credentials (CDK)
3. Point Google at the Cognito redirect URL
4. Set the frontend env vars (Vercel) and redeploy

You need two things before starting: the **Cognito Hosted UI domain prefix**
(we default to `tas-hair-auth`, giving the domain
`tas-hair-auth.auth.eu-west-1.amazoncognito.com`) and the **production app URL**
(the Vercel domain for the Tas Hair app). Have both handy.

---

## Part 1 — Create Google OAuth credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and sign in.
2. Create a project (or pick an existing one), e.g. "Tas Hair".
3. Open **APIs & Services -> OAuth consent screen**:
   - User type: **External**.
   - Fill in app name ("Tas Hair"), a support email, and a developer contact email.
   - Add your domain under authorized domains: `amazoncognito.com` (and your app
     domain if you have a custom one).
   - Scopes: the defaults (`email`, `profile`, `openid`) are enough — no sensitive
     scopes needed.
   - While the app is in "Testing" mode only test users you list can sign in.
     When you're ready for the public, click **Publish app** (no Google review is
     required for these basic scopes).
4. Open **APIs & Services -> Credentials -> Create Credentials -> OAuth client ID**:
   - Application type: **Web application**.
   - Name: "Tas Hair Cognito".
   - **Authorized JavaScript origins:** add
     `https://tas-hair-auth.auth.eu-west-1.amazoncognito.com`
   - **Authorized redirect URIs:** add
     `https://tas-hair-auth.auth.eu-west-1.amazoncognito.com/oauth2/idpresponse`
     (this exact path is what Cognito uses — note it's `idpresponse`, not our app's
     `/auth/callback`).
5. Click Create. Copy the **Client ID** and **Client secret** — you'll need them in
   Part 2. Treat the secret like a password; don't commit it anywhere.

> If you change the Hosted UI prefix from `tas-hair-auth`, update the two Google
> URLs above to match.

---

## Part 2 — Deploy the backend with the Google credentials

The CDK stack reads the Google credentials and the app's callback URLs from CDK
context at deploy time (so the secret never lives in the repo).

From `bookings-engine/infra`, run:

```powershell
npx cdk deploy `
  -c googleClientId="<the Client ID from Part 1>" `
  -c googleClientSecret="<the Client secret from Part 1>" `
  -c hostedUiPrefix="tas-hair-auth" `
  -c oauthCallbackUrls="https://<your-app-domain>/auth/callback,http://localhost:5173/auth/callback" `
  -c oauthLogoutUrls="https://<your-app-domain>/login,http://localhost:5173/login" `
  --require-approval never
```

Notes:
- Replace `<your-app-domain>` with the real Vercel domain (e.g.
  `tas-hair-app.vercel.app` or your custom domain). Keep the `localhost` entries so
  local development still works.
- `oauthCallbackUrls` / `oauthLogoutUrls` accept a comma-separated list.
- This creates the Google identity provider, the Hosted UI domain, and updates the
  app client with the OAuth settings. It also adds a pre-token Lambda so Google
  users automatically get the tenant + customer role in their token.

> Important about the automated GitHub deploy: the `deploy.yml` workflow runs
> `cdk deploy` **without** these context flags, so a normal push would drop the
> Google config. Options:
> - Do the Google-enabled deploy manually (the command above) whenever infra
>   changes, **or**
> - Move the Google client ID/secret into SSM Parameter Store / GitHub Actions
>   secrets and update `deploy.yml` to pass them. (Tell me and I'll wire this up so
>   it's permanent and hands-off.)

After deploy, note the `HostedUiDomain` value from the CloudFormation outputs —
it should be `tas-hair-auth.auth.eu-west-1.amazoncognito.com`.

---

## Part 3 — Confirm the Google redirect URL

Double-check that the redirect URI you added in Part 1 exactly matches the deployed
Hosted UI domain:

```
https://tas-hair-auth.auth.eu-west-1.amazoncognito.com/oauth2/idpresponse
```

If they differ, Google returns a `redirect_uri_mismatch` error at sign-in. Fix it in
the Google Console credentials screen (changes there take effect within a minute).

---

## Part 4 — Turn on the button in the frontend (Vercel)

The "Continue with Google" button only appears when the frontend knows the Hosted UI
domain. In the Vercel project settings for the Tas Hair app, add these environment
variables (Production + Preview):

| Variable | Value |
| --- | --- |
| `VITE_COGNITO_DOMAIN` | `tas-hair-auth.auth.eu-west-1.amazoncognito.com` |
| `VITE_COGNITO_REDIRECT_URI` | `https://<your-app-domain>/auth/callback` (optional — defaults to the current origin + `/auth/callback`) |

Then redeploy the frontend (a new deploy picks up the env vars). The button now shows
on the sign-in and sign-up screens.

For local development, add the same `VITE_COGNITO_DOMAIN` to `tas-hair-app/.env`.

---

## How it works (quick reference)

1. User taps **Continue with Google** -> browser goes to the Cognito Hosted UI
   `/oauth2/authorize?identity_provider=Google`.
2. Cognito bounces to Google; the user approves.
3. Google returns to Cognito's `/oauth2/idpresponse`; Cognito creates/looks up the
   user and redirects to our app's `/auth/callback?code=...`.
4. `AuthCallbackPage` exchanges the code for tokens at `/oauth2/token`, stores the ID
   token (same as password login), and provisions the customer record from the
   token's email/name claims.
5. The pre-token Lambda ensures the token carries `custom:tenant_id` and
   `custom:role=customer`, so all API calls are authorized.

## Troubleshooting

- **`redirect_uri_mismatch` from Google** — the redirect URI in the Google Console
  doesn't exactly match the Cognito `/oauth2/idpresponse` URL. Re-check Part 3.
- **Cognito "redirect mismatch" after Google** — the app callback
  (`https://<your-app-domain>/auth/callback`) isn't in the deployed
  `oauthCallbackUrls`. Re-run the Part 2 deploy with the correct URL.
- **Signed in but API calls 401** — the pre-token Lambda didn't attach claims. Check
  the `bookings-pretoken` Lambda logs in CloudWatch.
- **Button doesn't appear** — `VITE_COGNITO_DOMAIN` isn't set on Vercel, or the build
  predates adding it. Redeploy the frontend.
