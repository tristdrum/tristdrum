# Airbnb browser pilot

Read-only host-website evidence service for the three personal studios: Bougainvillea, Spekboom and Jasmine. It is deliberately separate from the cleaner, support and booking-truth workers. No Airbnb or OpenAI model write operation exists in this pilot. `actions.mjs` contains typed future-action contracts that always refuse execution.

## Boundary and source

- Playwright launches Chromium on each refresh, visits only configured `www.airbnb.com/hosting/calendar...` URLs and the fixed hosting Messages page, and closes the browser. It blocks non-GET/HEAD/OPTIONS requests, third-party hosts, images, fonts, media and service workers. **Airbnb may use POST GraphQL/XHR for read-only rendering. We could not inspect the signed-in host network without a fresh authorized cloud login.** An offline POST-dependent fixture proves the request is blocked and the calendar fails closed, not that the live UI works. Do not loosen the rule without a separate write-risk review and a signed-in end-to-end check.
- Three listing names are fixed in `config.mjs`. Operators must configure **three exact host-calendar URLs** for the signed-in account; no listing IDs are guessed. The UI must visibly identify each selected listing. Each refresh reads three months of date statuses and follows at most 40 reservation-detail links per listing to read the labelled confirmation code, guest, status and check-in/out dates. Messages scan at most 30 threads and 100 messages per thread. A missing page, changed layout, pagination, cap or ambiguous field makes the whole snapshot unavailable.
- For current/upcoming stays the code may be behind the reservation options menu; the browser only opens that menu and reads the label, never clicking Copy or another action. This follows [Airbnb's host confirmation-code steps](https://www.airbnb.com/help/article/4174).
- Reservation snapshots include `guestProfileId` only when a single visible Airbnb guest-profile link exposes a numeric ID. Missing, hidden or ambiguous links yield `null`; display-name matches never establish identity. The live host-page link shape is unverified, so same-guest stayover classification remains unsupported until authenticated calibration confirms this field on both bookings.
- Complete snapshots and Playwright storage state share one AES-256-GCM encrypted, owner-only file on a 1 GB Fly volume. A failed refresh retains prior evidence on disk but makes it unavailable to MCP until a new complete refresh succeeds. Calendar TTL is 15 minutes; messages TTL is 5 minutes. The server polls on those intervals and `refresh_before_plan` triggers both on demand (reusing a successful result from the last minute).
- Opening a Messages thread can have site-side read-receipt effects even with network writes blocked. The pilot must be calibrated against the authenticated UI and consented account before claiming the browser flow has no observable side effect. This code was not deployed or logged in during implementation.

## Configuration

Required runtime values (Fly secrets, never source control):

| Variable | Purpose |
| --- | --- |
| `AIRBNB_BROWSER_DATA_KEY` | Random 32-byte base64 key for encrypted session and snapshots |
| `AIRBNB_BROWSER_MCP_TOKEN` | Independent random bearer token, at least 32 characters |
| `AIRBNB_BROWSER_CALENDAR_URLS` | JSON object mapping `1`, `2`, `3` to exact Airbnb host-calendar URLs |

Optional: `AIRBNB_BROWSER_MESSAGES_URL` defaults to `https://www.airbnb.com/hosting/messages`; `AIRBNB_BROWSER_STATE_PATH` defaults to `/data/browser-state.enc`; `PORT` defaults to 3000. Only HTTPS `www.airbnb.com` hosting URLs are accepted. Do not put credential values or guest data in URLs, logs, or repository files.

**Rollout blocker: fresh cloud login.** No local Chrome-cookie copy, plaintext storage-state import, automated login, challenge bypass or production session is provided. A later authorized bootstrap must let a human sign in to a Playwright browser **running inside the pilot Fly app**, then call `persistFreshCloudLogin` on that same browser context. That helper accepts state only in the pilot Fly runtime, validates Airbnb cookie domains/origins and writes it directly to the encrypted store without a plaintext file. A secure way for the human to view/control that cloud browser has not been built or approved. Stop the polling service during bootstrap and restart it afterward to avoid stale in-memory state overwriting the new login. Subsequent successful refreshes persist rotated session state encrypted on the volume.

## API and Agents API

`POST /mcp` is an authenticated stateless Streamable HTTP MCP endpoint. `GET /metrics` uses the same bearer token and contains only freshness, auth and budget metadata. `GET /healthz` is liveness only. MCP offers exactly `get_calendar_snapshot`, `list_message_threads`, `get_message_snapshot` (one thread ID required), `refresh_before_plan`, and `get_pilot_status`; there is no arbitrary URL, browser command, reservation mutation or send tool. Tool results are limited to 256 KiB and counted against the transfer budget. Use `Authorization: Bearer <AIRBNB_BROWSER_MCP_TOKEN>` over HTTPS; never pass it in a URL.

Agents API session configuration can use this service without a sandbox:

```json
{
  "environment": { "type": "none" },
  "agent": {
    "model": "<approved-model>",
    "tools": [{
      "type": "mcp",
      "server_label": "airbnb_browser",
      "transport": {
        "type": "http",
        "server_url": "https://<pilot-host>/mcp",
        "authorization": "Bearer <secret supplied at session creation>"
      },
      "connection_origin": "service",
      "required": true,
      "allowed_tools": ["get_calendar_snapshot", "list_message_threads", "get_message_snapshot", "refresh_before_plan", "get_pilot_status"]
    }]
  }
}
```

`agents-adapter.mjs` builds this narrow connection object for callers to put under `agent.tools`, along with `environment: {type: "none"}`. This follows [OpenAI Agents API MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp) and the [Agents API quickstart's environment-none option](https://developers.openai.com/api/docs/guides/agents-api/quickstart). The adapter/protocol tests exercise tool discovery and calls locally; no OpenAI API session or model call is created by this service. Future reasoning must be event-triggered, not polling-triggered.

Guest text returned by the tools is untrusted content for any downstream agent; it is evidence, not instructions or authority to act.

## Budget and deployment handoff

`fly.toml` specifies one shared-CPU 1 GB Machine in `jnb`, one 1 GB volume and no HA. The budget gate reserves US$8.50 per SAST calendar month for infrastructure and stops refreshes at US$10 estimated incremental usage or 2 GiB counted transfer (browser response bodies plus conservatively doubled MCP result payloads); each browser run is capped at 50 MiB. The read-only pilot makes zero model calls. This is a **software activity cap, not an invoice guarantee**: Fly region pricing, outbound traffic, IPs, storage snapshots and taxes are outside the meter. Confirm the region's live quote and set an account-level alert before deployment. The estimate assumes one Machine, no dedicated IPv4 and no other additions. [Fly pricing](https://fly.io/docs/about/pricing/) lists per-second Machine billing and volume charges.

Build context is the repository root; the app-local Dockerfile uses the pinned official Playwright image, whose version matches the package. Use only `/Users/tristdrum/.local/bin/fly-personal` after checking personal account identity and app status. This branch does **not** authorize app creation, volume creation, secrets, login, deployment or guest messaging. A later authorized rollout must implement the fresh cloud-login bootstrap and validate the live Airbnb selectors, network methods, booking-code details, message completeness, read-receipt behavior and actual cost before trusting data in operations. Run `npm --prefix apps/airbnb-browser test` for local tests.
