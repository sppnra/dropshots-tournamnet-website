# Dropshot Folks — Netlify registration architecture

## Scope

The existing vanilla JavaScript tournament engine remains intact. This phase centralizes registration, organizer registration management and the confirmed-entry bridge. It does not migrate scoring or draws.

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
