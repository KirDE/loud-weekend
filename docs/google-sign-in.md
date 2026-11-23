# Google sign-in operations

Google OpenID Connect is off by default. It does not replace password or
passkey authentication. The normal account and plan remain the same when a
signed-in user explicitly links a Google account. A matching email alone never
links an existing account. For a new account, Google supplies a verified email;
this does not mark the application's own email verification as complete.

## Configuration and rollout

1. Apply the additive Google identity/authorization-attempt migration before
   enabling the feature. Keep the same protected `AUTH_SECRET` across instances.
2. Create a web OAuth client using [Google's OpenID Connect setup
   instructions](https://developers.google.com/identity/openid-connect/openid-connect).
   Register the exact `APP_URL` origin plus `/api/auth/google/callback/`, including
   the trailing slash. Use a canonical HTTPS origin, not a path or an alternate
   hostname. Store `GOOGLE_OIDC_CLIENT_ID` and `GOOGLE_OIDC_CLIENT_SECRET` in protected
   server runtime configuration; do not expose them as build-time client variables.
3. Review the site's privacy documentation (#430) and the provider consent
   screen before accepting users. The app requests only `openid email`. It
   stores the Google subject attached to the account, and uses the verified
   email only to create a new account if that address is available. It does not
   retain provider tokens. An authorization attempt expires in five minutes;
   successful callbacks consume it and subsequent starts prune expired attempts
   in bounded batches. Exclude callback query strings, cookies, and provider
   token bodies from proxy, application and observability logs.
4. With an approved test environment and designated test accounts, set
   `GOOGLE_OIDC_ENABLED=true`. Confirm account selection, first and repeat
   sign-in, sign-out, cancellation, and that a matching existing email is
   rejected until the user signs in via password/passkey and links explicitly.
   Verify the same account ID and saved plan before and after linking.
   Check the target with the flag off as well. CI uses a synthetic provider;
   this controlled real-provider check is separate and must pass before general
   enablement.

## Rollback

Set `GOOGLE_OIDC_ENABLED=false` and reload the app configuration. The provider
buttons and handlers become unavailable; existing sessions and password and
passkey sign-in remain unchanged. Keep the additive tables and identity links.
Accounts created solely through Google cannot start a new session while the
provider is disabled; account recovery must be addressed before a permanent
withdrawal. Do not delete identities as part of a flag rollback.
