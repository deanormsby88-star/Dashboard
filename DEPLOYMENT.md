# Deploying DeanOS — plain-English guide

No coding needed. You will create three free accounts (Supabase, Vercel,
OpenAI), copy-paste a few values, and click a few buttons. Allow 30–45
minutes. Zapier comes afterwards (see `ZAPIER_SETUP.md`).

What each service does:

- **Supabase** — hosts the database (where DeanOS stores meetings, tasks, etc.)
- **Vercel** — hosts the app itself (the website you'll log into)
- **OpenAI** — the AI that reads meetings and extracts tasks
- **Zapier** — the messenger between Circleback, DeanOS and Todoist

---

## Step 1 — Create the database (Supabase)

1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub.
2. Click **New project**.
   - Name: `deanos`
   - Database password: click **Generate a password** and **save it
     somewhere safe** (password manager). You need it in step 1.5.
   - Region: pick the one closest to you (e.g. Sydney).
3. Wait a minute or two for the project to finish setting up.
4. Left sidebar → **SQL Editor** → **New query**. Open the file
   `db/supabase-setup.sql` from this repository on GitHub, click the
   copy button, paste it into the SQL editor, and press **Run**.
   You should see "Success. No rows returned."
5. Get the connection string: click **Connect** (top of the Supabase
   dashboard) → under **Transaction pooler**, copy the URI. It looks like:

   ```text
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres
   ```

   Replace `[YOUR-PASSWORD]` with the database password from step 2
   (remove the square brackets too). Keep this — it's your `DATABASE_URL`.

## Step 2 — Get an OpenAI key

1. Go to <https://platform.openai.com> → sign in / create an account.
2. Add a payment method under **Settings → Billing** (usage for one person
   is typically a few dollars a month).
3. **API keys** → **Create new secret key** → name it `deanos` → copy the
   key (starts with `sk-`). It is shown only once — save it.

## Step 3 — Put the app online (Vercel)

1. Go to <https://vercel.com> → **Sign up** → **Continue with GitHub**.
2. **Add New… → Project** → find the `Dashboard` repository → **Import**.
3. Before clicking Deploy, open **Environment Variables** and add each of
   the following (Name on the left, Value on the right, **Add** after each):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the connection string from Step 1.5 |
   | `OPENAI_API_KEY` | the key from Step 2 |
   | `OPENAI_MODEL_MEETING_PROCESSOR` | `gpt-4.1` |
   | `ZAPIER_WEBHOOK_SECRET` | a long random code (see note below) |
   | `SESSION_SECRET` | another long random code |
   | `DEANOS_EMAIL` | your login email |
   | `DEANOS_PASSWORD_HASH` | the scrambled version of your login password |
   | `APP_URL` | leave out for now — added in Step 4 |

   Random codes: any 40+ character random string works. Password hash:
   someone technical runs `npm run hash-password -- 'the-password'` once,
   or ask Claude to generate password + hash + secrets for you.

4. Click **Deploy** and wait (~2 minutes) for the confetti.
5. Click the preview image / **Visit** — your app is live at an address like
   `https://dashboard-xxxx.vercel.app`. Copy that address.

## Step 4 — Tell the app its own address

1. In Vercel: your project → **Settings → Environment Variables** →
   **Add**: Name `APP_URL`, Value = the address you just copied
   (including `https://`, no trailing slash).
2. **Deployments** tab → the three-dots menu on the latest deployment →
   **Redeploy** (this makes the new variable take effect).

## Step 5 — Log in

Open your app address, sign in with `DEANOS_EMAIL` and your password.
You should see the Today page with everything empty — correct, because
nothing is connected yet.

## Step 6 — Connect Circleback and Todoist

Follow `ZAPIER_SETUP.md`. In short: two Zaps in Zapier —

1. **Circleback → DeanOS**: sends each finished meeting to
   `https://YOUR-APP-ADDRESS/api/webhooks/zapier/circleback` with the
   secret header `X-DeanOS-Secret` = your `ZAPIER_WEBHOOK_SECRET`.
2. **DeanOS → Todoist**: a Catch Hook whose URL you paste back into
   Vercel as `ZAPIER_TODOIST_CREATE_HOOK_URL` (then Redeploy), a
   "Create Task" step in Todoist, and a callback step that reports the
   created task back to DeanOS.

Note: Zap 2 has three steps, which requires a paid Zapier plan.

## If something goes wrong

- **"Invalid environment configuration" error page** — a variable is
  missing or mistyped in Vercel → Settings → Environment Variables.
  Fix it, then Redeploy.
- **Can't log in** — email must exactly match `DEANOS_EMAIL`; the password
  must be the one that was hashed into `DEANOS_PASSWORD_HASH`.
- **Meetings not appearing** — check Settings → Webhook log inside DeanOS.
  If the log is empty, the Zap never reached the app (wrong URL or secret).
  If an event shows "failed", the error message says why, and there is a
  Retry button.
- **Meeting stuck on "failed" with an OpenAI error** — usually billing not
  set up on the OpenAI account, or a mistyped key.
