# Dropshot Folks — Netlify registration edition

This is the complete project, extending the existing HTML/CSS/JavaScript tournament app. Registration uses **Netlify Functions + Netlify Database + Netlify Identity**. Players do not need accounts. Draws and live scoring stay in the organizer's browser for this phase.

## What is included

- Public, mobile-friendly singles and doubles registration; full teams or “I need a partner”.
- Event opening/closing, closing dates, capacity, partner matching and automatic waitlist switches.
- Organizer login; tournament/event/status filters, player search and registration statistics.
- Confirm, waitlist, reject, withdraw, delete and registration details.
- Pair two players into one doubles entry.
- Confirmed registrations automatically import into the existing Entries screen. Repeated confirmation and refresh do not duplicate entries.
- Server validation, private contact details, transaction-safe capacity and idempotent submissions.
- Existing tournaments, formats, standings, seeds, courts, scoring rules, results and JSON backups.
- Fixes for premature knockout advancement, seeded placement, group crossover pairings and undo at game/match boundaries.

## Start here

1. Extract the ZIP into a new folder. The folder containing `package.json` is the project root.
2. Keep your existing tournament browser data. On the current site, export a JSON backup from Tournament setup before deploying.
3. Use a **Netlify build deployment**, as explained below. This project includes Functions; uploading only the HTML files or dropping this source ZIP into Netlify Drop does not build the backend.
4. Enable Database and Identity for your existing Netlify project.
5. Complete the registration test below before sharing the link.

No database credentials belong in `config.js`. Its `/api` setting already works on your Netlify domain.

## Local testing

Install Node.js **22.12 or newer** from https://nodejs.org/ (Node 22 LTS is sufficient). Open a terminal in the extracted project folder:

```sh
npm install
npm test
npm run build
npm run dev
```

The terminal prints two links:

- Organizer demo: http://127.0.0.1:8888/__dev/organizer
- Player demo: http://127.0.0.1:8888/register?tournament=local-demo-tournament

Open the organizer link, select **Registrations**, and choose **Dropshot Folks Local Demo** in the tournament filter. Open the player link in a private browser window. Register, then refresh the organizer dashboard and confirm the player. Open Entries and select Singles.

The local demo uses a real in-memory PostgreSQL engine and the same registration service as production. Its clearly marked demo organizer login is **local-only**. It is not a real Netlify Identity login, is not included in the deployed Functions, and all central demo records reset when the terminal server stops. Your browser's tournament data still uses localStorage.

For a browser-based automated check:

```sh
npx playwright install chromium
npm run test:browser
```

This starts its own local server, checks mobile registration through confirmation and Entries, checks privacy, and saves screenshots under `test-results/`. Keep port 8899 free. Real Netlify Identity invitation/login and Netlify Database provisioning must also be checked on your deployed site.

## Netlify deployment — existing site

Your existing address can stay **https://comforting-choux-1c87b3.netlify.app/**.

### Recommended: connect a Git repository

1. Put the complete extracted project into a GitHub repository. Include all nested folders; do not upload only the frontend. Exclude `node_modules`, `.pnpm-store`, `.verification`, `.netlify`, `test-results` and any private `.env` files.
2. Open your existing project in the [Netlify dashboard](https://app.netlify.com/).
3. Go to **Project configuration → Build & deploy → Continuous deployment** and link that repository. If already linked, update the existing repository instead.
4. In its build settings, use:

   | Setting | Value |
   | --- | --- |
   | Base directory | Blank when `package.json` is at the repository root; otherwise the folder containing it |
   | Build command | `npm run build` |
   | Publish directory | `dist` |
   | Functions directory | `netlify/functions` |

   `netlify.toml` supplies these defaults. Node 22 is also configured there.
5. Deploy the updated repository. Check that the deploy log reports a successful frontend build and the `registration-api` Function.
6. Complete Database and Identity setup below, then run the test checklist.

The lockfile supports pnpm installations, and a normal clean `npm install` also works. The frontend build bundles the Identity client and publishes only the intended browser files to `dist/`. Functions and database migrations deploy separately from `netlify/`.

### Alternative: deploy from your computer

With the full project extracted and dependencies installed:

```sh
npx netlify-cli login
npx netlify-cli link
npx netlify-cli deploy --build --prod
```

Select your **existing** project when linking. These commands require your Netlify login; they do not create an admin account in the tournament app. Enable the services below and verify the database migration in the deploy logs. Do not use a plain static upload in place of the build deployment.

## Database setup

1. In your Netlify project, go to **Data & Storage → Database**.
2. Select **Create a database manually** if no database exists yet. If Netlify provisioned it automatically during deployment, use that database.
3. Deploy this complete project with `netlify/database/migrations/202609300001_registration.sql` included. Netlify's native migration system applies this file during deployment.
4. In the database view, verify these tables exist: `tournaments`, `events`, `players`, `teams`, `team_members`, `registrations`, `event_entries`.
5. If the database was enabled after your first deployment, trigger another build/deploy.

Netlify Database is available on credit-based plans. If Database is not available for your project, enable it on an eligible Netlify plan before accepting registrations. The backend is already structured for it; there is no alternate external database or silent local-storage fallback for public signups. The UI reports a clear service-unavailable error until setup is complete.

Official references: [Database setup](https://docs.netlify.com/build/data-and-storage/netlify-database/getting-started/), [automatic migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/), [availability](https://docs.netlify.com/build/data-and-storage/netlify-database/).

## Environment variables

No application secret needs to be copied into a browser file.

| Variable | What to do |
| --- | --- |
| `NETLIFY_DB_URL` | Netlify provisions the correct database connection for the deploy. Do not enter it into frontend code or commit it. |
| `NETLIFY_DB_DRIVER` | Managed by Netlify to select the appropriate database driver. Do not override it. |
| `NODE_VERSION` | Already set to `22` in `netlify.toml`. |
| `AWS_LAMBDA_JS_RUNTIME` | Already set to `nodejs22.x` in `netlify.toml`. |

Identity runtime authentication is supplied by Netlify. There is no shared admin password, database API key or organizer secret in this repository. Never set an environment variable to an external backend connection for this project.

## Admin login setup

1. Open **Project configuration → Identity** in your Netlify project and select **Enable Identity**.
2. Set registration preferences to **Invite only**. Players register for tournaments without using Identity.
3. Under Identity users, select **Invite users** and enter your organizer email.
4. On that user's detail page, assign the role **`organizer`** and save. The `admin` role is also accepted by the backend. Ordinary Identity users have no registration-management access.
5. Open the invitation email and follow its link back to your site. The app opens Registrations and asks you to set a password of at least 12 characters.
6. Sign in on the Registrations page with your email and password. If you added the role after signing in, sign out and back in so the new role takes effect.

Forgot password is available on the login form. Invitation and password-recovery callbacks are handled by the bundled Identity client. Use your deployed HTTPS site to verify the real invitation and login flow.

Official references: [Identity setup](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/), [assigning roles](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/manage-existing-users/).

## Testing registration on your Netlify site

1. On your existing organizer browser, create/open a tournament. Use a fresh test event with an empty draw.
2. Open **Registrations** and sign in.
3. Switch its event to **Open**, set capacity and a future closing date, and select partner matching / automatic waitlist as needed.
4. Click **Save & publish registration** and **Copy link**.
5. Open the link on another phone or in a private browser window. Only open, unexpired events should appear.
6. Register a singles player. Check that the success screen says **Pending confirmation**.
7. Refresh the organizer's Registrations page. Check the player and their private contact details.
8. Click **Confirm**. Open the existing **Entries** screen, select the event, and verify the player appears automatically. Refresh again and verify there is still only one entry.
9. Register two doubles players using **I need a partner**, select them in **Needs partner**, and click **Pair Players**. Verify one doubles team appears in Entries.
10. Fill the capacity with confirmed entries. New complete registrations should be waitlisted with automatic waitlist on, or rejected as full with it off.
11. Open public pages and `/api/tournaments` without logging in. Email addresses and phone numbers must not appear. `/api/admin/registrations` must return a sign-in error to anonymous visitors.

## What remains local

Tournament engine data remains in `localStorage` under the original `dropshot-folks-v1` key: draws, group assignment, seeds, matches, scores, scoring rules, court assignments, results and manual entries. This keeps existing tournament functionality intact.

Published tournament/event registration metadata, players, teams, registrations and confirmed registration entries are central. A new organizer device can load the registration catalogue and import those confirmed entries. It does **not** download the draw or match scores from another device.

Capacity counts centrally confirmed registration entries, once per team. Local manually entered teams are outside the central registration system in this phase. Pending registrations do not reserve a confirmed place. Partner-needed registrations are confirmed only when paired, subject to capacity. Admins can explicitly confirm above capacity when necessary.

Changing a paired team's status releases/restores the whole team's place. Deleting one member's registration withdraws the team. Deleting a registration does not necessarily erase shared player/team records used by other entries.

Roster changes are not imported into an existing local draw. Clear the affected local draw first; the UI explains when synchronization is pending. Keep tournament-day scoring on one organizer browser until the next migration. Removing a registered Entry should be done through Registrations → Withdraw, so the central record and other devices agree.

To close registration, switch its events off and publish. Deleting a local tournament only removes that browser's tournament engine data; it does not delete published registration records. Close registration centrally first.

## Repository structure

```text
index.html / app.js / styles.css          Existing tournament console
register.html / register.js               Public registration
registration-admin.js                    Organizer registration interface
api.js / config.js                       Same-origin API client
identity-client.js                       Netlify Identity client entry point
netlify.toml                             Deployment and /register routing
netlify/functions/registration-api.mjs    Protected/public API
netlify/database/migrations/              Relational registration schema
server/                                  Validation, transactions and service
scripts/                                 Frontend build and local demo server
tests/                                   Engine, SQL/API and browser tests
package.json / lockfiles                  Dependencies and commands
```

## Next migration — not implemented here

Move entries, matches, score events and court scheduling into shared Netlify Database tables, with concurrency control and live public updates. Registration is ready for that later step; this release deliberately keeps the scoring engine local.
