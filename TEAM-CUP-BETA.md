# Team Cup beta — corrected admin, capacity and payment flow

The current 2026 event has **18 Team Slots**, four players by default and £22 per person (£88 per team). Date: 18 October 2026, 09:00–16:00 Europe/London. Venue: Westminster City School, 55 Palace Street, London SW1E 5HJ. Registration closes at the end of 13 October. These settings are editable in the Team Cup dashboard; 18 is a preset, not a validation limit for future tournaments.

## Deploy this update

1. Extract the complete ZIP and commit/upload all contents to the root of the GitHub repository connected to your existing Netlify site. Include scripts/, server/, tests/, netlify/functions/ and all **four** migrations. Do not upload only frontend files.
2. Keep your existing site, Database and Identity users. Build command: `npm run build`; publish: `dist`; Functions: `netlify/functions`; Node: 22.12 or newer.
3. Redeploy. New additive migration `202610030004_cup_admin_payments.sql` changes only the known 2026 preset's old capacity of 12 to 18, preserves other capacities/results/rosters/tokens, permits reserve members and adds private Team Cup payment records to the existing durable email outbox. Do not recreate the database or manually rerun previously applied migrations.
4. In Netlify environment variables configure **Functions-scoped** `EMAIL_API_KEY` (Brevo API key, not SMTP key), `EMAIL_FROM` (plain verified email address), optional `EMAIL_REPLY_TO`. Never put these in config.js, browser scripts or a public repository. Redeploy after changing variables.
5. In Brevo register and verify the exact sender used by EMAIL_FROM, and check that transactional sending is enabled and your quota is available. Official guidance: https://developers.brevo.com/docs/send-a-transactional-email and https://developers.brevo.com/docs/api-key-authentication.
6. Sign in through the standard Registrations screen using an Identity **organizer or admin** role, then open **Team Cup β**. Existing events/results remain in place. The corrected capacity should be visible without republishing/resetting the draw.
7. Open **Bank details and email diagnostics (private)**. Save the tournament's account name, optional bank name, six-digit sort code, eight-digit account number and reference prefix. Click **Check email configuration / verified sender** to inspect configuration and Brevo sender status without exposing the key.

No live deployment, sender verification, API-key inspection or real email delivery was performed by the local tests. An accepted message may still bounce; inspect Brevo transactional logs for inbox delivery.

## Create and run the 2026 event

For an existing event, do not create a replacement or reset its draw. For a new installation, click **Create Team Cup 2026**. Its stable ID is `t_team_cup_2026`; clicking create again does not reset existing data.

Team registration: `https://comforting-choux-1c87b3.netlify.app/team-cup-register.html?tournament=t_team_cup_2026`.

The captain submits the configured number of players with names, emails, phones, shirts and category eligibility. At least two men's-category and two women's-category players are needed for MD/WD/XD. Position 1 is captain. All player emails must be distinct; active duplicate players require a reasoned admin override. Pending teams do not reserve approved capacity. The page displays the configured slot count and approved count; when approved capacity is full, another submission is waitlisted only if automatic waitlisting is enabled, otherwise rejected with a clear capacity message. Waitlisted teams cannot score until approved and assigned to the competition.

Choose format (groups + knockout, single round robin + knockout, or direct knockout), group count, qualifiers, courts and scoring rules, then approve teams and generate fixtures. Group assignments are editable before drawing. Team seeds influence default draw ordering; explicit group selections take precedence. Every actual tie has MD, WD and XD. Rules support 11/15/21 points and one game/best of three. All three discipline matches normally finish before progression; two wins clinch the tie.

## Full organizer/admin controls

Both Identity roles have the same management permission. Public users can only register/read public data. Referee tokens can only score their assigned unfinished match; organizer-only controls cannot be invoked through a token.

- Settings: tournament name/date, start/end time, venue, capacity, registration closing/open status, automatic waitlist, team size (4–20 including reserves), fee per person, member-email option, format, groups (1–8), qualifiers (up to 32 total), stage rules and courts.
- Teams: approve, pending, waitlist, reject, withdraw; capacity override; edit name/player details/eligibility/shirts, replace/remove/add players, choose captain and set seed. Team size changes affect new registrations. Roster changes do not silently recalculate already approved charges.
- Match operations: lineups (including a confirmed eligibility override), court movement, start, point, undo, award, walkover, current-game correction, all-game score correction, reopen/reset completed match and generate/regenerate/disable referee links.
- Dedicated overrides: move a team between drawn groups, create/edit/delete group fixtures, correct a tie winner and manually insert/advance a team into a knockout slot.
- Payments: private bank settings, mark received, retry approval/receipt, correct amount due, reopen as pending.

Changing started/completed data requires a confirmation and reason. Audit entries record the trusted Identity actor. Draw/format resets retain a private before-state snapshot and revoke affected match links. Moving a group team resets that team's group fixtures and the knockout; unrelated group scores remain. Score/result changes reset affected downstream matches when explicitly overridden; do not perform these casually during play. A manual tie winner is labeled as an organizer override publicly and need not rewrite all individual scores.

Removing a player clears affected unfinished lineups, requiring organizer reassignment; completed lineup names remain available through a names-only archive. Started lineup changes require confirmation. Withdrawal awards unfinished matches as walkovers and preserves completed results. For late approved teams, use group/fixture or knockout overrides to put them into the existing competition.

## Approval and payment emails

Save bank details before approving. **Approve** commits confirmed registration and one payment snapshot/reference, then sends payment instructions to the captain. The default four-player event creates **Pending / £88**. Instructions contain tournament/team names, all member names, date/venue, per-person fee, team size/total, bank details and the stable unique payment reference. Enable **Email team members as well as captain** to send separate private messages to each member for subsequent emails.

**Mark payment received** commits Paid, the received timestamp and Identity actor, then sends the receipt. Repeated approval, paid marking and retry do not duplicate sent emails. Definite failures can be retried; uncertain sends outside the deduplication window require checking provider logs instead of a blind resend.

Email failure never undoes approval or payment. The dashboard shows the provider/configuration reason and each email's status. Fix the problem and use **Retry approval email** or **Retry receipt**. For teams approved on the older beta, click **Initialize payment / instructions** on the existing confirmed team to initialize its payment record and instructions, or mark it received if it has already paid. The migration does not automatically bill or email old teams.

Correcting an amount does not rewrite previously sent mail. Reopening a paid record preserves its reference and sent-mail history. Do not resend old pending instructions after the payment has been recorded.

Server logs identify email type, registration/team ID, recipient, provider HTTP status/reason, API-key presence and configured sender. They never log the key, passwords or bank account numbers. Protected `GET /api/admin/email-diagnostic` checks environment/sender configuration; it sends no email and returns no secrets.

## Referee phone and public acceptance test

1. Select a discipline match, assign two players per side and a court, then save. Generate/copy its referee link: `https://SITE.netlify.app/referee.html#token=SECURE_TOKEN`. Send it yourself to the referee. Regeneration and disabling invalidate old links.
2. Open the link on a phone in a private browser window. No Identity login is needed. Only the assigned match and its lineup names should appear, with large scoring buttons. Add a point, then Undo.
3. Confirm the organizer and public live board show the same scores. A stale concurrent mutation must refresh with a conflict instead of overwriting. Award a test match; completed referee links are read-only. Regenerate/disable and verify old access stops.
4. On a separate test site register a team, approve it, check Confirmed/Pending/£88 and captain instructions in Brevo, mark paid, and check timestamp/receipt. Check public pages contain no phone/email/bank data/tokens. Logged-out admin routes must return 401; a signed-in user without organizer/admin role must return 403.

Public board: `https://comforting-choux-1c87b3.netlify.app/team-cup.html?tournament=t_team_cup_2026`. It shows courts, scores, group standings, fixtures, knockout and champion. Organizer refresh: 3 seconds; public and referee idle refresh: 5 seconds. Hidden tabs pause polling. No paid realtime service is used. Free plan Functions/Database/email quotas still apply.

## Storage and remaining boundaries

Team Cup metadata/settings, registrations/member contacts, groups/ties, lineups/courts, shared scores, versions, referee links, audits, bank settings, payment snapshots and email delivery records use Netlify Database through Functions. Existing standard tournament draws/scores and its navigation/roster bridge still use localStorage; standard registration/payment data remain centrally stored.

The disciplines remain fixed MD/WD/XD. The roster minimum is four to cover the categories; reserves are supported up to 20. Group/direct knockout qualification supports up to 32 teams; use groups for larger registration capacities. Exact ranking ties still use team name/ID after tie wins, match difference and point difference. No captain accounts, messaging automation or background email scheduler is added. Retries are explicit. Email delivery stops attempting additional recipients after a 30-second request budget; unfinished recipients remain queued for retry, allowing larger reserve rosters to stay within the Netlify Function limit. Netlify/Brevo real deployment and phone connectivity must be tested on your account.

## Files changed and added

Changed: server/team-cup.mjs, server/team-cup-engine.mjs, server/registration-service.mjs, server/api-handler.mjs, server/payments.mjs, server/email.mjs, server/email-templates.mjs, team-cup-admin.js, team-cup-register.js, team-cup-ui.js, tests/team-cup.test.cjs, tests/team-cup-browser.cjs, README.md, ARCHITECTURE.md, this guide.

Added: server/cup-payments.mjs, netlify/database/migrations/202610030004_cup_admin_payments.sql, tests/cup-corrections.test.cjs.

Verification commands: npm test; npm run build; npm run test:browser; npm run test:team-cup-browser. Browser tests use Playwright Chromium (or DROPSHOT_BROWSER_CHANNEL=msedge). Tests use fake email adapters and never send real mail.

Verification: all 54 automated tests, fresh npm installation/production build, standard registration/payment browser flow and Team Cup registration/roster/payment/referee/public browser flow passed locally.
