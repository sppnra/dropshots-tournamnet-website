# Team Cup beta — deployment and tournament-day guide

This extends the existing Netlify app. The Team Cup preset uses the **written request's 12-team limit**, rather than the poster's 18 slots:

- Dropshot Folks Badminton Team Cup 2026
- Sunday 18 October 2026, 09:00–16:00 (London)
- Westminster City School, 55 Palace Street, London SW1E 5HJ
- Up to 12 approved teams, 4 players each
- £22 per person, £88 per team; free T-shirts
- Registration closes at the end of 13 October 2026, Europe/London
- Every actual tie has exactly MD, WD and XD (Men’s, Women’s and Mixed Doubles)

## Deploy the complete updated repository

1. Export a backup of your existing standard tournament browser data before updating the site.
2. Extract the new ZIP into its own folder. Upload/commit **all contents** at your GitHub repository root, including scripts, server, tests, netlify/functions and all three netlify/database/migrations files. Do not upload only the top-level frontend.
3. Keep the existing Netlify project, Database, Identity users and organizer roles. Build command: `npm run build`; publish directory: `dist`; Functions directory: `netlify/functions`; Node 22.12+.
4. Redeploy. Netlify applies the new additive `202609300003_team_cup.sql` migration before publishing. Do not recreate your database or rerun the original create-table migration manually. Existing standard registration and payment tables remain intact.
5. No new environment variable, account, database, email provider or payment gateway is needed for Team Cup. Keep your existing payment-email variables for standard registrations. This beta does not automatically invoice/send approval emails for four-player Cup teams; its £88 fee is displayed for organizer-managed collection. Existing standard payment/email functionality remains available.
6. Confirm all new pages were built: team-cup-admin.html, team-cup-register.html, team-cup.html, referee.html and their JavaScript assets. No live deployment or real referee links are created merely by extracting this ZIP.

## Create this real tournament

1. Open the existing organizer site and sign in on **Registrations** with your Netlify Identity organizer account.
2. Click **Team Cup β** in the sidebar. It opens the dedicated operational dashboard using the same authenticated session.
3. Click **Create Team Cup 2026** once. It creates central tournament ID `t_team_cup_2026` with the real date/venue/settings. Clicking again does not reset it. This does not overwrite your standard local tournament.
4. Share the **Team registration** link: `https://comforting-choux-1c87b3.netlify.app/team-cup-register.html?tournament=t_team_cup_2026`.
5. A captain supplies four names, emails, phones, category eligibility and T-shirt sizes, and confirms permission to provide those details. Two men’s-category and two women’s-category players are required for the fixed disciplines; eligibility is self-declared and should be checked by the organizer. All four emails must be distinct. Position 1 is the captain. Team names and players cannot duplicate active team registrations.
6. Review pending teams on the dashboard. Approve, waitlist or reject before drawing. Only approved teams enter the draw; approval capacity is 12. Pending teams do not reserve slots. Withdrawals preserve records.
7. Open **Registration, groups and stage scoring settings**. Choose 2, 3 or 4 groups, qualifiers per group, courts, stage rules and optional third-place playoff. Default is 3 groups × 4 teams, top 2 each, group 1 × 21, later rounds best of 3 × 21.
8. With six qualifiers, two top-ranked group winners receive byes in a quarter-final round. Winners then reach the semi-finals and final. Four qualifiers start in semi-finals; two start in the final; three use a semi-final bye. Up to eight qualifiers are supported. Each group needs at least two teams and enough teams for its selected qualifier count.
9. Choose each approved team's group in the Teams table, then click **Generate groups / round robin**. The default distribution is balanced round-robin assignment; you can edit it before generating. Drawing closes registration and locks group count/roster. **Clear unstarted draw** can correct setup before scores exist (or after all affected scores have been undone); it preserves teams/audit but revokes the old match links.

## Lineups, courts and referee links

1. Select a discipline match in **Match operations / referee links**.
2. Assign two players per side from the correct team. MD requires two men’s-category players; WD two women’s-category players; XD one of each. Mixed can reuse players from MD/WD, but those players cannot be in two live matches at once.
3. Select a court and click **Save lineups & court**. A referee cannot start scoring until both lineups and a court exist. Three matches need not run simultaneously. The server blocks a second live match on the same court or involving the same player.
4. Click **Generate referee link**, then **Copy referee link**. Send the copied link yourself through WhatsApp. The app does not automate messaging.
5. Links use `https://SITE.netlify.app/referee.html#token=SECURE_RANDOM_TOKEN`. The token is in the fragment so it is not sent in normal page requests/referrers. The referee page also accepts `referee.html?token=...` for compatibility, but generated links use fragments.
6. **Regenerate** invalidates the old token immediately. **Disable link** removes its scoring/read access. Tokens remain private in Netlify Database and organizer responses; public board APIs contain none.
7. Completed matches are read-only to referees. Organizer controls retain Undo, score correction, Award, Walkover, court movement and token management. Lineups are locked after play starts; undo to the beginning before changing them. Corrections affecting downstream results require undoing those downstream scores first. Audit events are retained; use **View audit trail** for the selected match.

## Test a link from your phone

Before tournament day, use test teams/draws and the local demo, or clearly marked test teams on a separate Netlify test project. Do not mix test results into the real event.

1. On your laptop assign a match's court/lineups and generate a referee link.
2. Open the copied link on a phone in a private browser window. No Identity/admin login is needed. Expect only the assigned match, court, discipline, player names, current game and large buttons.
3. Press +1 TEAM A; check the organizer and public board show the same point within their refresh interval. Press Undo; expect the previous game state to return.
4. Open a second phone/tab and try a stale score action. The server returns a conflict and refreshes the scorer, instead of silently overwriting.
5. Award a test match after confirmation; expect the referee buttons disabled/read-only. Regenerate or disable its token on the laptop; the old link must then say unavailable.
6. Public and referee APIs must not show player email/phone, shirts, bank details, organizer menus or other referee tokens. Opening `/api/admin/team-cup?tournament=t_team_cup_2026` while logged out must return 401.

## Public live scores, standings and results

Share `https://comforting-choux-1c87b3.netlify.app/team-cup.html?tournament=t_team_cup_2026`.

The public page shows live courts, scores, group standings, ties, upcoming knockout slots and the champion. It reads the same central Database through Netlify Functions. Organizer refresh is every 3 seconds; public and referee idle refresh are every 5 seconds. Hidden pages pause polling; mutations are sent only on button presses. No WebSockets/realtime service is added. Public boards show a freshness timestamp and a connection-loss warning rather than silently presenting stale scores as current.

A tie is clinched at two discipline wins, but **all three disciplines must finish** before the tie is complete, standings tie wins update and winners progress. This preserves individual-match/point differences. Ranking is tie wins, individual-match difference, then point difference; exact remaining ties use team name/ID deterministically. Live points and completed individual matches appear in standings during a tie. Award/walkover results count match wins without inventing point scores. Group qualifiers populate knockout automatically once every group tie is complete. Semi-final losers populate third place if enabled.

## Storage boundary and beta limitations

- **Netlify Database:** Team Cup metadata/settings, team/member registrations, categories/shirts/contacts, groups/ties, discipline matches, lineups/courts, game scores, match versions, referee tokens and score audit events. Referees and spectators do not need localStorage to see scores.
- **localStorage:** Existing standard tournament engine, standard draws/scores/seeds, local roster bridge and ordinary organizer navigation. Standard registration/payment data remain centrally stored as before.
- Team Cup is a dedicated mode; four-player teams do not enter the existing singles/doubles Entries screen. Standard tournament controls and payment emails are separate and unchanged.
- Fixed four-player/three-discipline beta, maximum 12 approved teams and 8 qualifiers. No captain accounts, captain lineup edits, advanced tie-breakers, scheduled court times, messaging automation or video.
- Group count/roster are frozen after drawing. Withdrawing a drawn team awards its unfinished matches to its opponents as audited walkovers. Prior completed results remain intact. Withdrawn teams are excluded from qualification. If a group lacks enough active teams, progression pauses with a warning; reduce qualifiers before knockout. There is no replacement-team substitution or automatic redraw of a started competition.
- Stage-rule changes update pending matches only; live/completed matches keep their scoring snapshot. Score versions prevent stale writes; a per-Cup transaction lock makes tie/bracket updates consistent. Only changed match rows are written per scoring action.
- A referee link is a bearer capability: anyone you share it with can score that match until revoked. Do not post it publicly. Organizer routes still require Identity roles and same-origin JSON mutations. Tokens are random 256-bit values, checked by hash; raw copies are only available to authenticated organizers.
- Polling/Functions/Database still consume Netlify plan quotas. No paid-only feature or external realtime provider is added, but a free-plan quota may pause the site. The API rate cap allows multiple phones behind one venue Wi-Fi IP; use the public board only where needed and close unused tabs.
- This delivery is locally tested. Native Netlify Identity, migration application, phone connectivity and real multi-device deployment still need the acceptance test above on your site.

## Files changed and added

Changed: `app.js`, `index.html`, `styles.css`, `scoring-core.js` integration, `server/registration-service.mjs`, `server/api-handler.mjs`, `netlify/functions/registration-api.mjs`, `netlify.toml`, `scripts/build.cjs`, `scripts/package.py`, `scripts/verify-clean.cjs`, `tests/helpers.cjs`, `tests/browser-smoke.cjs`, `package.json`, `README.md`, `ARCHITECTURE.md`.

Added: `scoring-core.js`, `server/team-cup.mjs`, `server/team-cup-engine.mjs`, `netlify/database/migrations/202609300003_team_cup.sql`, `team-cup-admin.html`, `team-cup-admin.js`, `team-cup-register.html`, `team-cup-register.js`, `team-cup.html`, `team-cup-live.js`, `team-cup-ui.js`, `referee.html`, `referee.js`, `tests/team-cup.test.cjs`, `tests/team-cup-browser.cjs`, this guide.

The scoring core shares the existing two-point lead and cap rules with standard mode. No package dependency is added. The Cup tables use normalized teams/members/matches/tokens/audit plus a small versioned JSON document for group/tie structure, avoiding a generic tournament-framework rewrite.

Run `npm test`, `npm run build`, `npm run test:browser`, and `npm run test:team-cup-browser` (after `npx playwright install chromium`, or using the available Edge channel). Tests cover all three disciplines, invalid/scoped/revoked tokens, point/undo, completed tie standings, 2/3/4 group qualification, byes, semifinal/final/third place, public privacy, stale writes, court/player overlap, pre-knockout corrections and standard mode regression.

Verification: clean installation, all 48 automated tests and production build passed. Standard registration/payment browser checks and Team Cup mobile/browser flow passed; the mobile test also checks stylesheet loading and button size. Live Netlify deployment remains to be verified.

