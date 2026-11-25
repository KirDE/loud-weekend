# Administrative access

Administrative access is deny-by-default and uses two independent server-side gates. The account email must be present in the protected `ADMIN_EMAILS` deployment allowlist, and its persisted database role must be `EDITOR` or `ADMIN`. The allowlist never grants privileges to a `USER` by itself. `EDITOR` may read the console, review changes, and save drafts, while only `ADMIN` may trigger refresh operations. Both the page and API enforce roles server-side. Every cookie-authenticated mutation, including logout, requires an exact same-origin `Origin` header before it may change session or database state, and every accepted administrative mutation records the authenticated session user in `AdminAuditEntry`.

Requests with a missing, opaque (`null`), malformed, path-bearing, or foreign `Origin` fail closed with 403. Production-owned service routes use a separate bearer-token boundary and intentionally do not use the browser-origin guard; cookie-authenticated non-browser clients must send the configured application origin explicitly.

Role assignment is an operator-only database operation. From a trusted deployment shell with `DATABASE_URL` configured, run:

```sh
npm run admin:assign-role -- editor@example.com EDITOR --confirm
```

Use `USER` to revoke access. Review the target email and requested role before confirmation. The application exposes no public role-assignment endpoint.

After deployment, smoke-test `/admin` and `/api/admin` as anonymous, an allowlisted ordinary user, editor, and administrator accounts. Anonymous and ordinary-user requests must be denied, including when the ordinary user's email is allowlisted. Editors must be denied refresh with 403, and administrators must be able to trigger a refresh. Cross-origin mutation requests must return 403 for every role.

## Correction reports

The separate correction queue uses the same allowlist and role checks. Its reports record the authenticated reviewer ID and decision timestamp in a single conditional update. Neither decision publishes catalogue data. Submitted evidence URLs are checked against existing official hosts and are never fetched by the application.

The correction endpoint uses the existing submission salt (or authentication secret) to derive a rate-limit bucket; it does not retain a raw address. The trusted reverse proxy must set or remove `X-Real-IP` and prevent direct access to the app port. If the header is missing or invalid, reports share a fallback bucket. The global limit applies regardless of proxy configuration.
