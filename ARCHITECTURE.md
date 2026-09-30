# Dropshot Folks — Netlify registration architecture

## Scope

The existing vanilla JavaScript tournament engine remains intact. This phase centralizes registration, organizer registration management, approval emails, manual bank-transfer tracking and the confirmed-entry bridge. Standard scoring/draws remain local; the dedicated Team Cup beta stores its scoring/draws centrally.

```text
Player phone                         Organizer browser
register.html + register.js          index.html + app.js
          |                          registration-admin.js
          |                          Netlify Identity session
          +-----------+----------------------+
                      |
                 api.js → /api/*
                      |
            Netlify Function: registration-api
          server-side validation / Identity role check
                      |
                  Netlify Database
        tournaments / events / players / teams
        team_members / registrations / event_entries
```

Frontend assets are built to `dist/`. Only the explicit static-file allowlist and bundled `identity.js` are published. `server/`, tests, local demo scripts and database SQL are not public assets. Netlify separately bundles `netlify/functions/` and applies native migrations from `netlify/database/migrations/`.

## Storage boundary

| Shared on Netlify Database | Local organizer browser |
| --- | --- |
| Published tournament name, date and venue | Full tournament engine state |
| Event registration metadata and revision | Stage scoring rules and seeds |
| Players and private contact information | Draws and group assignments |
| Teams and membership | Match games, points and history |
| Registration states | Court assignment and results |
| Confirmed registration entries | Manual entries and a local copy of confirmed registration entries |

The existing `dropshot-folks-v1` localStorage key is retained. Contacts fetched by organizers stay in memory and are never copied into local tournament entries or JSON tournament backups.

## Relational model

- `tournaments`: stable local tournament ID, registration metadata, publication and optimistic metadata revision.
- `events`: stable local event ID, tournament link, singles/doubles type, format label, capacity, open flag, London closing date, partner matching and automatic waitlist.
- `players`: one record per tournament/email, reused across events. Public requests cannot overwrite contact information already in use.
- `teams`: optional chosen team name or a derived “Player 1 / Player 2” label.
- `team_members`: ordered membership, with uniqueness constraints preventing duplicate members.
- `registrations`: player/team references, status, request UUID and optional confirmed-entry reference.
- `event_entries`: one confirmed singles player or doubles team with a stable ID and active flag.

There are no match, draw, scoring or realtime snapshot tables in this phase.

## API

One modern Netlify Function routes the following endpoints:

| Method/path | Access | Behavior |
| --- | --- | --- |
| `GET /api/tournaments?tournament=ID` | Public | Open/unexpired registration catalogue; no contacts |
| `GET /api/capacity?tournament=ID` | Public | Confirmed counts and open-event metadata |
| `POST /api/registrations` | Public | Validated signup; returns only its receipt |
| `GET /api/admin/session` | Organizer | Verified organizer identity |
| `GET /api/admin/catalogue` | Organizer | Registration metadata, including closed events |
| `POST /api/admin/catalogue` | Organizer | Atomically publish configuration with revision check |
| `GET /api/admin/registrations` | Organizer | Private registration list, filters and status counts |
| `PATCH /api/admin/registrations/UUID` | Organizer | Confirm, waitlist, reject or withdraw |
| `DELETE /api/admin/registrations/UUID` | Organizer | Delete registration; deactivate its confirmed team |
| `POST /api/admin/pair` | Organizer | Atomically pair two players and confirm one doubles entry |
| `GET /api/admin/entries?tournament=ID` | Organizer | Active Entries projection: IDs and names only |

Registration-list filters are `tournament`, `event`, `status`, `search` and `offset`. Responses contain up to 200 rows and a `next_offset`; the frontend retrieves remaining pages. Frontend filters provide immediate feedback for club-size datasets.

## Security

`@netlify/identity` handles invitations, password login, recovery and session refresh. The modern Function calls `getUser()` and requires a signed `organizer` or `admin` role before any admin operation. Client-supplied role fields are never accepted. Identity should be configured as invite-only.

Database connection credentials come from the Netlify runtime through `@netlify/database`. There is no direct browser/database connection and no public database key. Public API queries use explicit field projections; they never query or return registration contact lists.

All mutations require a matching request Origin and JSON content type. The handler bounds request size, validates IDs/UUIDs, names, email, phone, booleans, capacities and dates, and uses parameterized SQL. Server errors return a generic service-unavailable response rather than SQL details. Responses are `no-store`, and the Function has Netlify's per-IP/domain rate limit.

Public registration request UUIDs support retrying a submission after a lost response without creating another record. A retry returns the corresponding receipt, never contacts or other registration details. Duplicate active player registrations within an event are rejected, including appearances as a teammate.

## Transactions and capacity

The service uses `getDatabase().pool.connect()`; BEGIN, work, COMMIT or ROLLBACK all run on the same connection. The affected event row is locked for signup, confirmation, withdrawal, pairing and deletion. This serializes competing operations and avoids capacity-count races.

Only active confirmed `event_entries` consume capacity. Pending signups do not reserve places. A paired team consumes one place even though both individual registration records become confirmed. Full complete entries are waitlisted when enabled; full events with automatic waitlist off reject new submissions. Confirmation checks capacity again, with an explicit administrator override available.

Confirm creates/reuses one entry ID and updates the registration in the same transaction. Repeating confirmation does not create another entry. Pairing creates the team, membership, one entry and both status changes atomically; repeating the successful pair returns the existing result. Status changes on a paired team apply to both members and toggle the same entry's active flag.

Published configuration uses a tournament revision and advisory lock. Stale metadata saves return a conflict instead of overwriting another organizer's settings. Refresh reloads published registration settings.

## Confirmed Entries bridge

After an organizer mutation or refresh, the frontend requests the names-only Entries projection. It adds missing entries using their stable database IDs, marks them `source: 'registration'`, and removes withdrawn/inactive imported entries when no local draw exists. Seeds and manual entries remain local.

If a local event has a draw, roster changes are deferred and explained in the UI; clear that draw before synchronizing. Other devices cannot know whether the original device's local matches have started. This is a deliberate phase boundary, not a claim of shared tournament-day scoring.

## Existing engine fixes

Knockout slots with unfinished feeder matches are not treated as byes. Seed placement separates the top seeds, and group qualifiers retain the intended crossover pairings. Scoring history stores a before-state for each action, so game-ending and match-ending actions can be reversed. A result cannot be changed while a later dependent match has started. Court/player overlap is checked against local live matches.

These checks operate on local tournament state; cross-device scorer synchronization is reserved for the next phase.

## Development and verification

- `npm run build`: copy allowed static assets, bundle the Identity client with esbuild.
- `npm test`: engine regressions and real PostgreSQL-compatible schema/service/API tests using PGlite.
- `npm run dev`: loopback-only demonstration server with an in-memory database and local demo organizer session.
- `npm run test:browser`: mobile public signup, central persistence, admin confirmation, Entries import and public-contact privacy.
- `scripts/verify-clean.cjs`: optional verification helper to copy fresh sources, install with a supplied npm CLI, run tests and produce a production build.

PGlite and Playwright are development dependencies only. Production Functions use Netlify Database; production organizer authentication uses Netlify Identity. The local demo authentication route is implemented only in the undeployed development server.

Live database provisioning and Identity invitation/password-login verification require a configured Netlify project. The source archive does not contain account credentials or an already-provisioned database.


Registration publish diagnostics
--------------------------------
Publish preserves local tournament/event IDs, explicitly marks the tournament published, commits settings, and checks the anonymous public GET before reporting registration open. A local draft status does not control public registration. New events have no closing date by default; existing explicit closing dates are preserved and expire after that day in Europe/London. Full events with automatic waitlist remain visible.

In Registrations, use **Inspect published database** after signing in. It reads `GET /api/admin/catalogue-diagnostic?tournament=ID` and shows tournament metadata, persisted event settings, counts, and visibility reasons, without player contacts. The endpoint requires organizer/admin Identity roles. Function logs include IDs, row presence, enabled/closing checks and final reason. Canonical links use `/register?tournament=ID`; `/register.html?t=ID` remains supported. After updating an older deploy, inspect the closing date, clear or correct it if appropriate, and publish again.


## Payment and email extension

`202609300002_payments.sql` is additive to the deployed schema. Events get `entry_fee numeric(10,2)` in GBP and `payment_required boolean`, defaulting to zero/false. Existing confirmations are grandfathered as not_required; reconfirming them never creates a retrospective charge. Existing pending entries use the published event configuration when first approved. Registration status remains unchanged and is independent of payment status.

Private `tournament_payment_settings` stores bank fields and an optimistic revision. It is never part of the public catalogue or localStorage. `registration_payments` is unique per `event_entries.id`, with stable reference, amount snapshot, approved_at, sent timestamps, received_at/by and separate payment status. Pairing two registrations creates one shared charge. The registration list left-joins these fields; pending/legacy rows default to not_required (shown as Not started for unapproved registrations). `payment_audit` preserves the first paid action and trusted Identity actor. No reversal action is implemented. Withdrawal/delete-registration retain payment, audit and email history.

Approval/pairing take the existing event lock, activate an entry, create its payment snapshot, update registrations, and commit atomically. `PaymentService.deliver` runs only after commit; an email failure is returned as an organizer warning, without rollback. Paid marking also commits and writes one audit before sending the optional receipt. Payment stats count each payment once using an EXISTS confirmed registration predicate, excluding withdrawn/rejected/waitlisted entries. GBP calculations aggregate integer pennies in JavaScript, converting to displayed pounds only at the end.

`payment_email_outbox` has a unique (payment_id,kind,recipient) key, private rendered HTML/text payload, attempt state/time, UUID idempotency key, acceptance timestamp and provider ID. One message per recipient keeps doubles players' addresses private. Content/reference/amount is fixed at queueing. Missing bank details prevent queueing an approval email but never undo approval; fixing settings and retrying creates the first valid content. Retrying an already queued message uses its original bank snapshot. Once paid, use a receipt rather than sending old pending-payment instructions.

A short row-lock transaction claims an outbox message; the HTTP call occurs outside the transaction. Concurrent callers skip a live 45-second claim. Network calls time out at six seconds. Definitive failures can retry; uncertain/crashed attempts reuse the same provider key only within a conservative 14-minute window. After that, automatic resend is blocked and the organizer checks Brevo logs. The outbox is durable but not a background scheduler; retries are explicit organizer actions. Sent timestamps mean provider acceptance; bounces/inbox delivery are outside this phase.

The provider abstraction is `server/email.mjs`, rendering is `server/email-templates.mjs`, orchestration is `server/payments.mjs`. Default production sender is Brevo's free transactional HTTP API with server-only EMAIL_API_KEY, EMAIL_FROM and optional EMAIL_REPLY_TO. No provider SDK, payment gateway or additional database is added. The local demo and tests inject a fake sender and never contact real mailboxes.

New organizer routes, protected by the existing Identity roles, Origin check and JSON validation:

- GET/POST `/api/admin/payment-settings` (GET takes tournament; POST takes tournamentId, revision and bank fields).
- GET `/api/admin/payment-stats?tournament=ID`.
- POST `/api/admin/registrations/UUID/payment` with `{sendEmail:boolean}`; actor comes from Identity, never the request body.
- POST `/api/admin/registrations/UUID/retry-email` with `{kind:'approval'|'payment'}`.

All new tables revoke public access. Public catalogue/capacity/receipt projections deliberately omit bank fields, payment references, histories, email states and contacts. Static build's allowlist remains unchanged; email provider code and keys cannot enter dist. README contains free-tier limits, verified-sender setup, Functions-scoped environment variables, migration/redeploy steps and live acceptance checks.


## Team Cup beta central scoring

The additive 202609300003_team_cup.sql migration adds team_cups (versioned group/tie document linked to tournaments), normalized team_cup_teams, team_cup_members, team_cup_matches, referee_tokens and score_events. No existing table/data is removed. server/team-cup-engine.mjs derives tie results, standings and knockout progression; server/team-cup.mjs owns validation, transactions, team registration/approval, courts/lineups, scoped tokens and scoring/audit. scoring-core.js supplies the same win-by-two/cap mathematics to both standard and Cup modes. Standard engine storage and draw generation remain intact.

Each Cup mutation locks its Cup row and updates only changed match rows; scorer writes require an exact match.version. Read snapshots hold a share lock so tournament structure and scores are consistent. Every score action stores its before-state and actor; undo marks the original event undone and appends an audit entry. Completed upstream corrections invalidate only unstarted dependent matches and their tokens; started descendants must be corrected first. Group corrections before knockout play revoke/rebuild the unstarted knockout safely.

Tokens use 32 random bytes, hash lookup, and server-only raw copies for organizer link management. The assigned-match referee API receives a Bearer token and permits only point, undo or award while the match is unfinished. Organizer routes retain Identity organizer/admin checks and origin/JSON bounds. Referee GET projects only that match/tie/assigned lineup names. Public projections exclude tokens, audits, contacts, category/shirt data and bank fields. Referee URLs use fragments and no-referrer headers.

The standalone operational dashboard reuses the existing Identity session. The public board polls every 5s, organizer every 3s and referee every 5s while idle/visible; button mutations are serialized client-side. There is no realtime provider. The existing Function's rate cap is raised for multiple users sharing one venue IP; free-plan request/Database quotas still apply. See TEAM-CUP-BETA.md for schema, routes, setup, qualification policies and known operational boundaries.
