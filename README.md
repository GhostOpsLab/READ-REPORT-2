# Eksamen Arena

Study app for Jacques's November 2026 exams. Static site plus one Netlify Function. No AI runs inside the app: all content is JSON that is written from approved textbook pages.

## How it fits together

- `site/` is the website (login, exam map, revision cards, quizzes, admin page).
- `site/content/index.json` lists every exam and topic from the timetable. A topic with `"file": null` shows "Inhoud kom".
- `site/content/<topic>.json` holds the revision cards and question bank for one topic.
- `netlify/functions/api.mjs` handles login, progress and results. Data lives in Netlify Blobs. Accounts are invite-only.
- Results also go to your email through Netlify Forms (form name `uitslag`). Test accounts never send email.

## One-time setup

1. Push this folder to GitHub and connect the repo to Netlify (build command empty, publish directory `site`, functions `netlify/functions`; `netlify.toml` already says so).
2. In Netlify, Site configuration, Environment variables, add (never share these in chat):
   - `ADMIN_USER` your admin username
   - `ADMIN_PASSWORD` a long password
   - `SESSION_SECRET` a random string of 32 or more characters
3. In Netlify, Forms, open `uitslag`, Settings and notifications, add an email notification to yourself. (The form appears after the first deploy.)
4. Open `https://<your-site>/admin.html`, sign in, and create the accounts: one for Jacques, one marked "Toets-rekening" for you, and one per friend (get their parents' consent first, since you will see their results).

## Staging

Create a `staging` branch and enable branch deploys in Netlify. Non-production deploys use their own Blobs store, so test data never mixes with live data. Create a test account on staging via its own `/admin.html`.

## Adding content

1. Jacques photographs the pages named on the timetable.
2. Claude transcribes them, you approve the text.
3. Claude writes `site/content/<topic>.json` (5 to 8 short cards, 10 or more questions) and sets `"file"` on that topic in `index.json`.
4. Run `npm run check`, then push.

Card and question format: see `site/content/wisk-gewone-breuke.json` (currently flagged `"sample": true`; remove the flag once the content comes from his textbook).

## Learning rules (in `site/app.js`)

- Quiz of 6 questions, favouring ones he got wrong or has not seen.
- A topic is "Klaar" after 80% or more on two different days.
- Wrong answers point back to the revision cards they are tagged with.

## Checks

```
npm install
npm run check     # validates the content JSON
npm test          # backend tests (accounts, sessions, lockout, privacy)
node tools/smoke.mjs   # browser end-to-end test (needs Playwright)
```
