# IAL Biology Marker — deploying the real backend version

This version stores everything (accounts, mark schemes, submissions) in a shared
EdgeOne KV database instead of the browser, so it actually works across
different students' and teachers' devices. It needs a Git-based deploy
instead of the drag-and-drop "Makers Drop" you used before.

## 1. Push this folder to GitHub

1. Create a new **empty** GitHub repository.
2. Push the contents of this folder (`index.html` and the `functions/` folder)
   to it, keeping that exact structure at the repo root.

## 2. Import the repo into EdgeOne Pages

1. Go to the EdgeOne Pages console and choose **Importing a Git Repository**.
2. Connect your GitHub account and select the repo you just created.
3. Framework preset: none needed — leave build command empty, output
   directory as the repo root (`.`). This is a static `index.html` plus
   `/functions`, not a framework project.
4. Deploy.

## 3. Turn on KV storage and bind it to this project

1. In the EdgeOne Pages console, go to **KV Storage** and click **Apply Now**
   to activate the KV service on your account (free tier gives 1GB).
2. Click **Create Namespace** — call it something like `markbook`.
3. Open your project → **KV Storage** tab → **Bind Namespace**.
4. Select the `markbook` namespace, and for **Variable Name** enter exactly:

   ```
   markbook_kv
   ```

   This must match exactly — the functions reference `env.markbook_kv`.
5. Redeploy the project once the binding is in place (a binding only takes
   effect on the next deploy).

## 4. First login

- Admin: `admin` / `admin` — same as before, created automatically on first
  use. Change it immediately from the admin dashboard once you're in.
- Add your Anthropic API key from Admin → AI marking settings. It's now
  stored only in KV, server-side — no browser ever receives it, including
  the admin's own.
- Add teachers and students from their respective "Give Access" panels, and
  they can log in from any device, anywhere.

## What changed from the single-file version

- Accounts, mark schemes, and submissions live in EdgeOne KV (shared,
  server-side) instead of each browser's local storage — this is what makes
  cross-device login actually work.
- Mark schemes are now shared globally per Year/Session/Unit rather than
  scoped per teacher, since it's the same official document either way.
- The Anthropic API key is only ever read server-side, in
  `/functions/api/mark-with-ai.js` — it's not sent to the browser at all
  anymore, which closes the "someone could extract it from network
  requests" gap the old version had.

## Limits worth knowing

- KV values are capped at 25MB each, which is one mark scheme file or one
  student's full set of scanned pages — comfortably enough for normal use,
  but very large scans (dozens of high-resolution photos in one submission)
  could bump into it.
- The free KV tier is 1GB total across everything stored. Mark schemes and
  scanned submissions are the biggest consumers — worth checking usage in
  the EdgeOne console occasionally once you've got a few years of papers
  loaded.
