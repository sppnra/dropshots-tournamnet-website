# Dropshot Folks — Netlify registration edition

This is the complete project, extending the existing HTML/CSS/JavaScript tournament app. Registration uses **Netlify Functions + Netlify Database + Netlify Identity**. Players do not need accounts. Standard-mode draws and live scoring stay in the organizer's browser; Team Cup scores and progression are shared in Netlify Database.

## Team Cup beta

The complete project now includes the 18 October 2026 **Badminton Team Cup** preset: 18 configurable team slots (four players by default), captain registration, MD/WD/XD ties, shared live scores, secure referee links, groups and knockout. Open **Team Cup β** in the organizer sidebar after signing in. Read [TEAM-CUP-BETA.md](TEAM-CUP-BETA.md) for exact deployment, creation, lineup/referee/phone testing steps, storage boundaries and limitations. Team Cup is centrally stored; standard-mode draws and scores still stay in localStorage. Both organizer/admin roles have audited overrides and Team Cup captain payment emails. The capacity remains editable; this preset is corrected to 18.

## What is included

- Public, mobile-friendly singles and doubles registration; full teams or “I need a partner”.
- Event opening/closing, closing dates, capacity, partner matching and automatic waitlist switches.
- Organizer login; tournament/event/status filters, player search and registration statistics.
- Approve/confirm, waitlist, reject, withdraw, delete and registration details.
- Private bank settings, per-event GBP fees, approval emails, manual payment tracking and optional receipt emails.
- Pair two players into one doubles entry.
- Confirmed registrations automatically import into the existing Entries screen. Repeated confirmation and refresh do not duplicate entries.
- Server validation, private contact details, transaction-safe capacity and idempotent submissions.
- Existing tournaments, formats, standings, seeds, courts, scoring rules, results and JSON backups.
- Fixes for premature knockout advancement, seeded placement, group crossover pairings and undo at game/match boundaries.

## Approval emails and manual bank-transfer payments

Registration stays `pending`, `confirmed` (approved), `waitlisted`, `needs_partner`, `rejected` or `withdrawn`. A separate payment record is `not_required`, `pending` or `paid`. Before approval the table shows **Not started**. Approval reserves the roster place immediately, regardless of whether payment/email has completed. There is no payment gateway.

Set an **Entry fee** in GBP and **Payment required** independently for each event, then **Save & publish registration**. Doubles fees cover the whole team. A team formed by pairing two needs-partner registrations shares one charge, one reference and one payment history. At approval, the fee is frozen into `payment_amount`; changing the event fee later does not change an existing charge. References contain a 1–4-character prefix and 13 random hexadecimal characters (at most 18 characters), are database-unique and never change on retry/reconfirm.

In **Registrations**, after signing in, fill **Tournament bank details** and click **Save bank details**. These fields are stored only in Netlify Database, loaded only by organizer APIs, and not saved in localStorage or browser exports. They are not included in public catalogue, capacity or registration receipt responses. Bank details are saved separately from event publishing. Publish a new tournament once before saving its bank details.

Approving a paid event emails each player individually. Initial registration sends no email and displays **Pending organizer approval**. Free events send no bank instructions. Approval emails show the tournament, event/team, fee, bank details and reference. **Mark payment received** records the signed-in organizer and timestamp, retaining audit/history. The **Send an email when marking payment received** checkbox makes payment receipts optional. Payment actions work after draw creation because they do not change the roster. There is deliberately no reversal/delete-payment action in this release.

Revenue totals count confirmed roster entries once per team, using stored payment amounts. Rejected, withdrawn and waitlisted entries are excluded from expected revenue. Withdrawing an entry retains its payment history; this does not issue a refund or reverse an actual bank transfer.

### Email setup — Brevo Free

No email provider package is installed. `server/email.mjs` calls Brevo's transactional HTTP API from the Netlify Function. Brevo currently offers **300 email sends per day** on its non-expiring Free plan, including transactional messages. A two-player team consumes two sends per email type; approval plus receipt consumes four. Free emails carry Brevo branding. Choose Free and do not enable a paid subscription or paid extras. [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

1. Create a Free account at [Brevo](https://www.brevo.com/), verify your account email and complete the required account details. If transactional sending needs activation/review, complete that in Brevo before testing.
2. Open your account menu → **Settings → Senders, Domains, IPs → Senders → Add a sender**. Use **Dropshot Folks** as the sender name and an email address whose inbox you control. If you have no custom domain, use your existing mailbox for initial tests. Enter the six-digit code Brevo emails to that mailbox. [Sender setup](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)
3. Open **Settings → SMTP & API → API Keys & MCP → Generate a new API key**. Verify your account when asked, name it `Dropshot Folks Netlify`, and copy the ordinary API key. This app needs an **API key**, not an SMTP password or MCP key. Keep it private. Brevo can deactivate keys after 90 days without a successful API call; check this before a later tournament. [API-key setup](https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys)
4. In [Netlify](https://app.netlify.com/), open your existing project → **Project configuration → Environment variables → Add a variable**. Add:

   | Variable | Value |
   | --- | --- |
   | `EMAIL_API_KEY` | The private Brevo API key |
   | `EMAIL_FROM` | Just the verified mailbox address, e.g. `your-address@gmail.com` |
   | `EMAIL_REPLY_TO` | Optional organizer mailbox for player replies |

   Include the **Functions** scope (or All scopes if that is the available option), and set the Production context. Mark the API key secret if Netlify offers that option. Never put these values in `config.js`, `netlify.toml`, a frontend file or GitHub. [Netlify Function environment variables](https://docs.netlify.com/build/functions/environment-variables/)
5. Upload/commit the complete updated repository, including `server/` and **all four** SQL migrations. Keep `npm run build`, `dist`, and `netlify/functions` as before. Redeploy after setting the variables. The native Database migration adds the payment tables automatically; do not recreate your database or rerun the original create-table migration manually.
6. Sign in with the existing organizer Identity role. Publish a paid event, save bank details, and run the live test below.

Your website can stay on `https://comforting-choux-1c87b3.netlify.app/`. The website domain and email sender are separate. You cannot authenticate `netlify.app`, Gmail or Yahoo as an email domain you own. Brevo allows mailbox-code sender verification, but recommends a domain you control for reliable deliverability; free-address senders may be rewritten, filtered or rejected. Check Brevo logs and spam folders in your tests. No custom-domain purchase is required by the code or for initial mailbox tests; guaranteed inbox delivery is not promised. [Brevo sending-domain guidance](https://help.brevo.com/hc/en-us/articles/35852083084178-Domain-setup-for-better-email-deliverability)

No new paid service is required. Existing Netlify hosting, Functions, Identity and Database remain subject to your plan's quotas; stay within the free allowances. At Brevo's daily quota the provider may queue accepted messages for later delivery. The app's **sent** state means provider acceptance, not proof that a message reached the inbox.

### Failed emails and safe retries

Approval and payment commit first. Missing email credentials, bank details or a provider failure cannot roll them back. The organizer sees a warning, and **Details** shows email state and sent/received timestamps. Use **Retry approval email** or **Send/Retry payment email**. References, approved amounts and payment timestamps stay unchanged. A partially successful doubles email retries only the unsent player's message.

A database outbox records each recipient and email type uniquely and stores the rendered content privately. Row locks prevent concurrent sends. Brevo receives the same stored UUID idempotency key on retry. A timeout/crash can leave delivery **uncertain**; retry promptly within the conservative 14-minute window. Outside that window the app blocks an automatic resend to avoid duplicates: check Brevo **Transactional → Logs** and the player's inbox, then have the outbox record reconciled against that evidence by a maintainer. There is no force-resend override in the app. This intentionally prefers avoiding duplicate bank instructions over claiming impossible exactly-once delivery across the database and email provider. Accepted emails are never resent by reconfirming/reloading. No scheduler or paid queue is required; unsent work is retried by the organizer. [Brevo idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails)

### Exact live test after redeploy

1. Verify the Netlify build and both migrations succeeded. Keep your existing Database and Identity configuration.
2. In Registrations, set one test event's fee to `20.00`, Payment required **On**, Open **On**, closing date blank or in the future, and save/publish. Save valid bank details separately.
3. Open `/register?tournament=YOUR_EXISTING_TOURNAMENT_ID` in a private window. Submit with inboxes you control. Expect pending approval, no bank information and **no email yet**.
4. Refresh the organizer page and approve the entry. Expect Confirmed + Payment pending, a stable reference and £20.00. Check the approval email in the player's inbox/Brevo logs; for doubles check both inboxes. Click Refresh again: no duplicate email/entry.
5. Change the event fee to £25 and publish. The approved entry must still show £20.
6. Only after checking a real transfer, click **Mark payment received**. For a dry-run test, use a clearly marked test registration and test bank details rather than claiming receipt of a real payment. Leave the receipt checkbox on to test the second email. Expect Paid, organizer identity and received timestamp. Refresh: one receipt only.
7. Open Details and verify the amount/reference, approval/email dates, payment date and contacts. Compare Expected/Received/Outstanding; doubles counts once per team.
8. Test Payment required **Off** with a different registration: Confirmed + Not required; no bank email.
9. To test failure safely, remove `EMAIL_API_KEY` and redeploy a test environment, then approve a fresh test registration. Approval must remain Confirmed + Payment pending with a warning. Restore the key, redeploy and retry: same reference/amount, one successful email. Do the equivalent for a payment receipt; Paid must remain Paid. Do not disable production email during a real registration window.
10. In the logged-out window, inspect `/api/tournaments?tournament=ID`, `/api/capacity?tournament=ID` and signup receipts: no bank or payment-admin fields. `/api/admin/payment-settings?tournament=ID` must return 401.

### Automated checks and local email previews

`npm test` covers upgrade compatibility, no email at signup, paid/free approvals, snapshot/reference stability, double confirmation, two-recipient emails, shared partner payments, receipt auditing, partial and total failures, safe retries, authentication and public privacy, alongside the engine tests. `npm run build` builds production assets. `npm run test:browser` exercises publish/public-read, mobile signup, approval/Entries and the bank/payment UI.

`npm run dev` **never sends real emails**, even if email environment variables are present. It injects a preview sender that records only a local preview notice in the terminal. Local email states say sent to exercise the UI, but no real mailbox is contacted. Tests also use injected fake providers. Live Brevo sender verification and delivery must be tested separately after you configure your account.

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


Registration publish diagnostics
--------------------------------
Publish preserves local tournament/event IDs, explicitly marks the tournament published, commits settings, and checks the anonymous public GET before reporting registration open. A local draft status does not control public registration. New events have no closing date by default; existing explicit closing dates are preserved and expire after that day in Europe/London. Full events with automatic waitlist remain visible.

In Registrations, use **Inspect published database** after signing in. It reads `GET /api/admin/catalogue-diagnostic?tournament=ID` and shows tournament metadata, persisted event settings, counts, and visibility reasons, without player contacts. The endpoint requires organizer/admin Identity roles. Function logs include IDs, row presence, enabled/closing checks and final reason. Canonical links use `/register?tournament=ID`; `/register.html?t=ID` remains supported. After updating an older deploy, inspect the closing date, clear or correct it if appropriate, and publish again.


## Files changed in the approval/payment release

Frontend: `app.js`, `registration-admin.js`, `register.js`, `styles.css`.
Backend: `server/registration-service.mjs`, `server/api-handler.mjs`, `server/validation.mjs`.
Local/packaging: `scripts/dev-server.mjs`, `scripts/package.py`, `scripts/verify-clean.cjs`.
Existing tests: `tests/registration.test.cjs`, `tests/browser-smoke.cjs`.
Documentation: `README.md`, `ARCHITECTURE.md`.

New: `server/payments.mjs`, `server/email.mjs`, `server/email-templates.mjs`, `netlify/database/migrations/202609300002_payments.sql`, `tests/payments.test.cjs`, `.env.example`.
`tests/publish.test.cjs` also includes the prior publish/public-read regression coverage in this complete repository.

`package.json`, npm/pnpm locks, `netlify.toml`, Identity client and the original migration are retained. No email SDK/dependency is added. The complete source ZIP contains all original frontend, backend, scripts, tests, Netlify Functions and migrations folders; it excludes node_modules, generated dist, local caches, screenshots and private environment files.

Verification for this release: clean npm install, all 36 automated tests and npm run build passed. The Edge/Playwright browser flow passed with injected local email previews, including both registration URL forms, public privacy, roster import, private bank settings, doubles approval/payment and receipt states. Real Brevo mailbox delivery, Identity sessions and applying the migration to your live Netlify project are deployment checks, not claimed as performed locally.

Team Cup update: see TEAM-CUP-BETA.md for the additive 202610030004_cup_admin_payments.sql migration, editable settings/rosters/draw overrides and captain approval/payment emails. Use the protected Email diagnostics control to see missing environment variables or sender-verification failures; approval/payment state is committed before attempting mail.
