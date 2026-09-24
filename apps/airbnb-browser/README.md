# Airbnb browser pilot

Read-only, fail-closed host-website evidence code for Bougainvillea, Spekboom and Jasmine. This branch is **not a viable live source yet**. It was not deployed, logged in to a cloud browser, or used to send/change anything on Airbnb. All committed tests use synthetic guest, booking and profile data.

## Observed host UI

Read-only inspection of the existing signed-in personal browser on 2026-09-24 established the actual host origin and DOM shape; no browser cookies or guest content were copied into this repository or the cloud:

- Calendar URLs are `https://www.airbnb.co.za/multicalendar/<listingId>`. The page renders three simultaneous `div[role="grid"][aria-label="Month YYYY"]` month grids. Date buttons are inside grid cells and carry `data-date`; reservation bars are `div[data-testid="reservation-bar"]` inside clickable rows, not links. Clicking a bar opens `/multicalendar/<listingId>/reservation/<code>` and a sidebar with a labelled confirmation code, `guestFirstName`, and a visible `/users/profile/<id>` guest link.
- The Messages index is `https://www.airbnb.co.za/hosting/messages`, with thread IDs in `inbox_list_<id>` test IDs; detail URLs are `/hosting/messages/<threadId>`. The current message-list DOM does **not** expose the sender, timestamp and stable message ID contract used by the synthetic thread fixture. The extractor deliberately refuses that real layout, so Messages readiness remains false until those fields and history completeness are calibrated without causing read receipts.
- The observed signed-in Jasmine calendar reload made 159 GET and four first-party POST requests (tracking/client configuration). The pilot still blocks non-GET/HEAD/OPTIONS requests. An offline POST-dependent fixture proves this fails closed, but **does not prove the live calendar renders with POST blocked**. No live GET-only browser run with a fresh cloud login has occurred. Do not loosen network methods without a separate write-risk review.

The calendar parser validates all three rendered months, each month's day count, the current SAST month, and date-status evidence. It marks past unbooked days as `past`, never available. It opens at most 40 distinct reservation bars per listing, cross-checks the route code against the visible label, and takes check-in/out dates from the same bar. `status: "calendar_reservation"` means visible calendar occupancy, **not a verified confirmed lifecycle state**. `guestProfileId` is a numeric ID from one visible guest-profile link, or `null` if missing/ambiguous; display-name equality never establishes guest identity. The live selector path is grounded in inspected DOM, while the full scan and same-guest continuity still require a signed-in cloud end-to-end check.

## Storage and auth blocker

Complete snapshots and Playwright storage state use one AES-256-GCM encrypted, owner-only file on a 1 GB Fly volume. A failed/partial/expired refresh keeps prior evidence for diagnosis but makes it unavailable through MCP until a complete new refresh succeeds. Calendar TTL is 15 minutes; Messages TTL is 5 minutes.

No local Chrome-cookie copy, plaintext auth import, automated login, challenge bypass or production session is provided. **Fresh cloud login is a rollout blocker:** a separately authorized bootstrap must let a human sign in to a Playwright browser running inside the pilot Fly app, then call `persistFreshCloudLogin` on that same context. The helper validates `.airbnb.co.za` state and encrypts it directly, without a plaintext file. A secure human view/control path for that cloud browser has not been built or approved. Stop the service during bootstrap and restart it afterward; successful later refreshes persist rotated state encrypted.

Required Fly secrets/config: `AIRBNB_BROWSER_DATA_KEY` (32 random bytes, base64), `AIRBNB_BROWSER_MCP_TOKEN` (separate random bearer token, 32+ characters), and `AIRBNB_BROWSER_CALENDAR_URLS` (JSON map from units `1`, `2`, `3` to their exact `/multicalendar/<listingId>` URLs). Keep real IDs, cookies, credentials and guest data out of Git and logs. `AIRBNB_BROWSER_MESSAGES_URL` defaults to `https://www.airbnb.co.za/hosting/messages`; `AIRBNB_BROWSER_STATE_PATH` defaults to `/data/browser-state.enc`.

## Refresh, health and budget

The Fly config uses **`min_machines_running = 0`**. Chromium launches only for a refresh, and the Machine may stop between requests. An **external authenticated HTTP scheduler, not included in this branch**, must POST `/refresh/messages` every 5 minutes and `/refresh/calendar` every 15 minutes; these requests can wake the Machine. `refresh_before_plan` also forces both kinds from MCP. Without that scheduler, interval freshness is not delivered. All refresh routes use the same bearer token as MCP.

`GET /healthz` is liveness (HTTP 200) and includes `ready`; it does not claim authenticated source health. Authenticated `GET /readyz` returns 503 until auth, both snapshots and budget are current. Authenticated `GET /metrics` exposes freshness/auth/budget metadata without guest data.

The service reserves US$8.50 per SAST month as a conservative infrastructure allowance and blocks activity at US$10 estimated added spend or 2 GiB counted transfer. Browser runs cap at 50 MiB; MCP results cap at 256 KiB. The service itself makes zero model calls. **Agents API spend is also incremental:** a future caller must POST `/budget/reserve-agent` with a worst-case `maxUsd` *before* every event-driven Agents API call. No caller or actual API usage reconciliation is implemented here, so neither the software meter nor scale-to-zero Fly config guarantees the account's US$10 added-bill cap. Obtain a live region quote and account-level spending alert before any rollout. [Fly pricing](https://fly.io/docs/about/pricing/) is the pricing reference.

## Agents API

`POST /mcp` is a bearer-authenticated stateless Streamable HTTP MCP endpoint. It exposes only `get_calendar_snapshot`, `list_message_threads`, `get_message_snapshot`, `refresh_before_plan`, and `get_pilot_status`. There is no arbitrary URL/browser executor or Airbnb write tool; typed future actions always return `READ_ONLY_PILOT`. Guest text is untrusted data, not instructions.

`agents-adapter.mjs` constructs a service-origin HTTP MCP connection with `environment: {type: "none"}`, `required: true` and this five-tool allowlist, following the [official OpenAI Agents API MCP guide](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp) and [environment-none quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart). Unit tests exercise the MCP protocol locally; no OpenAI session or model call was created.

Build context is the repo root; `Dockerfile` pins the official Playwright image to the package version. Future Fly operations must use only `/Users/tristdrum/.local/bin/fly-personal` after confirming personal-account identity. This branch authorizes no app/volume/secrets creation, deployment, login or guest communication. Run `npm --prefix apps/airbnb-browser test` for local synthetic tests.
