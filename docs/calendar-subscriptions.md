# Private calendar subscriptions

From the signed-in planner, sync the plan and create a private subscription
URL. Add the URL as a subscription in a calendar application, rather than
importing it as a one-time download. The feed includes dated Going and Maybe
choices synced to the account for the seasons current when the link was issued.
Local-only changes do not appear until synced. To include a newly opened
season, replace the URL and update the calendar application.

The feed uses stable edition IDs and all-day, exclusive end dates per
[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html). Published dates are
read when the client polls; use the client's normal polling interval (hourly
or less often where configurable). Actual refresh timing and deletion of old
local copies depend on the client.

The URL authorizes read access without sign-in. The server stores only a digest,
so the unredacted link is shown once, when created or replaced. Keep the URL
private. Replacing or revoking a link, or deleting its account, prevents future
fetches; it cannot erase an event previously downloaded by a client.

Apply the additive migration before starting the application. At the HTTPS
edge, disable caching and redact query strings in access logs, error logs,
request tracing and analytics for `/api/calendar/feed/`. Verify that a
disposable test key does not appear in logs before enabling
`CALENDAR_SUBSCRIPTIONS_ENABLED=1` in the application runtime. Disabled
installations cannot issue or fetch links, but logged-in owners can revoke
existing links. The
management endpoint is authenticated and no-store; the feed is private,
no-store and noindex. Do not add the feed to navigation or sitemaps. Application
rollback makes the endpoint unavailable without deleting subscription records.
