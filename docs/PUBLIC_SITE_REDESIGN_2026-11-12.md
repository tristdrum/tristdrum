# Public website redesign — 12 November 2026

## Scope and content

The public portfolio, public artwork viewer and unknown-route recovery page were rebuilt for future partners, investors and collaborators. Copy focuses on Tristan's current company roles, specific product work, a dated engineering interview and working principles. Old revenue, equity, team-size and unverified venture claims were removed from the public README.

Public sources were checked on this date: WorkWeek's homepage and team page; Tech Local's homepage, about page and AI-employees page; and PowerSync's 13 September 2024 WorkWeek interview. [PRODUCT.md](../PRODUCT.md) links these sources. [Asset provenance](../web/public/ASSETS.md) records the existing public portrait and marketing demonstration image.

The user authorized design/copy decisions and release through the existing publishing route. Internal appearance was subsequently permitted as secondary work. Authentication, membership/admin gates, database schema, finance logic and operational workers were not changed. Secondary route bundles now load on demand, reducing the initial JavaScript bundle from approximately 258 KB to 129 KB gzip in local builds.

## Design review

Astra planning established the information hierarchy and seven visual directions. Official Impeccable source guidance was used from its upstream repository because the requested skill was not installed locally. The selected code-led direction is recorded in the [surface brief](../.impeccable/surfaces/web-src-pages-homepage-tsx.md). The detector reported no findings on the public components/styles.

A fresh reviewer examined desktop, tablet, narrow-phone and artwork captures. One 320px grid alignment issue was found and corrected. The verdict pass scored that fix resolved and returned **ship**, scoped to that correction; the original review found the other supplied elements matched the direction. No approved visual comp or external quality-bar card was part of this code-led build.

## Validation

- `npm --prefix web run lint`: passed.
- `npm --prefix web run build`: passed, with secondary routes emitted as separate bundles.
- `npm run airbnb:test`: passed (integration-dependent tests skip without the integration database variable).
- Local database tests in `npm run airbnb:release:test`: 74 pgTAP tests passed.
- Integration-enabled cleaner, core and database-access tests passed before the release command reached stock.
- Integration-enabled support tests were run separately and passed after the stock failure stopped the combined command.
- `npm run airbnb:web:test`: all 26 tests passed, including dashboard, redirect and finance calculations, after the bundle split.
- `git diff --check`: passed before publication.
- Browser review: 320, 390, 768, 1280 and 1440px layouts; no horizontal document overflow; fonts and images loaded. Keyboard skip link and visible focus checked; reduced motion disables the hero animation and link transitions.
- Local-only artwork fixtures verified ready/long-content, missing and connection-error/retry states, native audio metadata and playback, plus broken-image and broken-audio fallback links. No production artwork records were created or modified.
- Anonymous dashboard, finance, Airbnb, Task Pulse and artwork-admin routes redirect to sign-in with their return paths intact. No private session or production-data mutation was used for this review.
- Public external company, engineering-story and profile links returned HTTP 200. Contact remains a mail link; no message was sent.

## Existing full-release limitation

The full `npm run airbnb:release:test` command remains unsuccessful because the stock database integration test fails at `apps/airbnb-stock/database.integration.test.mjs:443` with `RESERVATION_UPDATE_UNRESOLVED` (“Reservation change needs a verified current Airbnb itinerary.”), raised from `apps/airbnb-cleaner/report.mjs:635`.

The same test and failure were reproduced against an untouched archive of starting commit `48858a451b76fa127aff9eb4b4cb92bb18499b35`, using the same local database. It predates this frontend change. Operational code was not altered to make the public release appear green. All integration work used the local OrbStack database on port 54322, never production.

## Publication evidence

The PR records the candidate commit and Vercel checks. The existing GitHub-connected Vercel project publishes merged `main` to `tristdrum.com`; the final release response records the merged commit, successful deployment status and production `version.json` readback. The manifest contains only the source commit identifier. Local fixture configuration and screenshots remain outside the repository.
