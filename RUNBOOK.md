# Going live

The ordered path from nothing to `portal.ownyourstudy.com`, with a checkpoint
after each stage. `README.md` is the reference organised by topic; this is the
sequence.

Roughly an hour, most of it waiting for Supabase and Cloudflare.

At any point:

```bash
cd portal && npm run preflight
```

which reports what is configured, what is not, and what each gap actually
costs. It changes nothing.

---

## Before you start

You need accounts on **Cloudflare** (the domain is already there) and
**Supabase**. Both have free tiers that comfortably cover a practice this size.

Optional, and each can be added later without redoing anything:
**OpenAI** for AI drafts, **Recall.ai** for the notetaker, **Google Cloud** for
automatic Meet links.

---

## 1 · Supabase project

1. Create a project at <https://supabase.com/dashboard>. Pick a region near
   your students — London if they are mostly UK/EU.
2. Save the database password it gives you. It is shown once.
3. **Project Settings → API** has the three values you need:

   | Dashboard label | Starts with | Goes in as |
   | --- | --- | --- |
   | Project URL | `https://` | `NEXT_PUBLIC_SUPABASE_URL` |
   | Publishable key | `sb_publishable_` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | Secret key | `sb_secret_` | `SUPABASE_SERVICE_ROLE_KEY` |

   The variable names still say *anon* and *service_role* after the older key
   format, which is what the Supabase client library expects. The **values**
   are the new publishable/secret keys; the legacy `eyJ…` JWT pair is disabled
   on this project and its signing key revoked. New keys can be rotated
   individually, which the old shared-secret pair could not be.

The service-role key bypasses every access rule in the database. It belongs in
Cloudflare secrets and in your own `.env.local`, and nowhere else — never in
`wrangler.jsonc`, never in the repo, never with a `NEXT_PUBLIC_` prefix.

---

## 2 · Migrations

Five files, and the order matters — RLS references tables the first one
creates.

```
supabase/migrations/
├── 20260825090000_initial_schema.sql
├── 20260825091000_rls.sql
├── 20260825092000_storage.sql
├── 20260825093000_workflow.sql
└── 20260826100000_google_calendar.sql
```

With the CLI:

```bash
cd portal
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Or paste each file, in filename order, into the dashboard's SQL editor.

**Checkpoint.** In **Table Editor** you should see `profiles`, `students`,
`tutors`, `lessons`, `lesson_notes`, `tutor_student_subjects` and about a dozen
more, and every one of them should show **RLS enabled**. If any table says RLS
is disabled, stop — that table is readable by anyone with the anon key.

---

## 3 · Authentication settings

In **Authentication → URL Configuration**:

- **Site URL**: `https://portal.ownyourstudy.com`
- **Redirect URLs**: add `https://portal.ownyourstudy.com/auth/callback`

In **Authentication → Providers → Email**: enable it, and **turn off public
sign-ups**. Accounts are created by invitation only; leaving sign-ups on lets
anybody create a profile against your database.

Sign-in links fail silently if the redirect URL is missing, so it is worth
re-reading that line.

### Custom SMTP — not optional

Supabase's built-in mail server sends **two emails per hour**, and the limit is
greyed out because it is not yours to raise. Two is fewer than one team. Every
invitation past the second fails, and the failure looks like a rate-limit error
rather than anything to do with email, so it is worth doing before stage 8
rather than discovering it there.

`ownyourstudy.com` sends through **Resend**:

1. <https://resend.com> → **Domains** → add `ownyourstudy.com`, region Ireland.
2. Choose **Manual setup**, not *Auto configure* — the latter wants standing
   write access to the whole Cloudflare DNS zone to add three records.
3. Cloudflare → **DNS → Records → Import**, and upload a BIND file with the
   three records Resend shows. Importing beats typing: the DKIM value is a
   1024-bit key and a single wrong character fails verification with no clue
   which character it was. Leave *Proxy imported DNS records* unchecked.

   ```
   resend._domainkey.ownyourstudy.com. 1 IN TXT "p=…"
   send.ownyourstudy.com. 1 IN MX 10 feedback-smtp.eu-west-1.amazonses.com.
   send.ownyourstudy.com. 1 IN TXT "v=spf1 include:amazonses.com ~all"
   ```

   Resend also offers an `MX` on the apex for **Enable Receiving**. Skip it
   unless you mean it: it makes Resend the inbound mail host for the entire
   domain.
4. Back in Resend, **Verify DNS Records**. A minute or two.
5. **API keys → Create**, permission *Sending access*. It is shown once —
   it is the SMTP password, and Supabase's password field cannot be read back,
   so keep a copy.
6. Supabase → **Authentication → Emails → SMTP Settings**, enable, and fill in:

   | Field | Value |
   | --- | --- |
   | Sender email | `no-reply@ownyourstudy.com` |
   | Sender name | Own Your Study |
   | Host | `smtp.resend.com` |
   | Port | 465 |
   | Username | `resend` |
   | Password | the Resend API key |

**Checkpoint.** Saving raises the rate limit from 2/hour to **30/hour** — the
banner says so. After the next invitation, **resend.com/emails** should show it
as *Delivered*. That is the only proof that matters; Supabase reporting success
only means it handed the message over.

---

## 4 · First deploy

> **This project deploys to Vercel, not Cloudflare Workers.** The built Worker
> came to 13 MB against the free tier's 3 MB script limit. Stages 4–6 below
> describe the Workers path and are kept for when that changes; today the
> deploy is `git push`, and the three secrets live in **Vercel → Settings →
> Environment Variables**. Set the two `NEXT_PUBLIC_` ones as type **Config**,
> not Secret — Vercel rejects a public-prefixed variable marked Secret, and the
> type cannot be changed after saving, only deleted and recreated.

Deliberately before the secrets, so you find out the deploy works while
nothing sensitive is attached to it.

```bash
cd portal
npx wrangler login
npm run cf:deploy
```

`wrangler login` opens a browser to authorise your Cloudflare account.

**Checkpoint.** It prints a `*.workers.dev` URL. Open it: the portal loads in
**demo mode**, with the invented students and the demo notice on the login
page. That is correct — no database is attached yet.

---

## 5 · Secrets

```bash
npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Each prompts for the value and does not echo it.

The first two are not really secret — they are compiled into the browser
bundle either way — but they live here so that pointing a deployment at a
different Supabase project is one command rather than an edit to a tracked
file. **Setting those two is what takes the portal out of demo mode.**

Optional, and safe to skip for now:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put RECALL_API_KEY
npx wrangler secret put RECALL_WEBHOOK_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Secrets apply on the next deploy, not immediately:

```bash
npm run cf:deploy
```

**Checkpoint.** Reload the `workers.dev` URL. The demo notice should be gone
and the login page should ask for an email and password. If it still says demo
mode, one of the first two secrets did not take.

---

## 6 · The custom domain

Short, because the zone is already on your Cloudflare account.

1. Cloudflare dashboard → **Workers & Pages** → `own-your-study-portal` →
   **Settings → Domains & Routes → Add → Custom domain**.
2. Enter `portal.ownyourstudy.com` and add it.

That is the whole DNS step. Cloudflare creates the record and issues the
certificate itself — no CNAME to add by hand, and no proxy setting to get
wrong. Usually live within a couple of minutes.

`NEXT_PUBLIC_APP_URL` in `wrangler.jsonc` is already
`https://portal.ownyourstudy.com`, so nothing to change there. If you deploy to
a different hostname, edit it and redeploy — it is what magic links and invite
links are built from.

**Checkpoint.** `https://portal.ownyourstudy.com` loads over HTTPS.

---

## 7 · Check it before anyone is in it

```bash
npm run preflight
```

Everything under **STOP** should be gone.

Then the access rules, against the real database:

```bash
npm run verify:access
```

It builds a throwaway world — two students, one tutor, two subjects, three
lessons, two sets of notes — signs in as each person with a **real JWT through
the anon key**, and asks the 24 questions that matter:

- the student cannot see another student's lessons
- the tutor cannot see a student they are not assigned to
- a lesson URL belonging to someone else resolves to "not found", not to a
  permission error — the two must be indistinguishable
- an unpublished write-up is invisible to the student
- the tutor's private notes never appear on a student page
- a student cannot promote themselves to admin
- a signed-out stranger reads nothing at all

Nothing is checked through the service role, because the service role bypasses
every policy and would pass no matter how wrong the rules were. Everything it
creates it deletes, including when a check fails; the three accounts are
throwaway and are removed on the way out.

Exit code 0 means every rule held. Anything else means a student can see
something they should not — fix the policy before real students exist.

Worth re-running after any change to `supabase/migrations/*_rls.sql`. The demo
repository mirrors these rules and the unit tests cover them, but RLS is SQL,
and SQL is only truly tested by a database.

---

## 8 · Your team

```bash
cp scripts/team.example.json scripts/team.json
```

Fill in the six real email addresses. The names are already there; **the
addresses are blank on purpose** — every row sends a real invitation.

```bash
npm run team              # dry run, prints exactly what it would do
npm run team -- --send    # sends the invitations
```

Needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`NEXT_PUBLIC_APP_URL` in `portal/.env.local`.

Evangelos is set to `"teaches": true`, which creates a tutor record alongside
the admin role — one account that both runs the practice and takes lessons.

Each person gets a one-time link that expires. Resend from **Admin → Tutors**
if anyone leaves it too long.

**Checkpoint.** Everyone appears under **Admin → Tutors**. Nobody can do
anything with a student until you create a subject and an assignment.

---

## 9 · The marketing site

```bash
cd ..
./build.sh
```

Upload `dist/` to Cloudflare Pages, as before. It contains the new **Your
Dashboard** section, whose links point at `portal.ownyourstudy.com` — which is
why the portal goes first.

---

## Optional integrations

Each is independent. Nothing else breaks if you never set one up.

### Google Meet links

1. Google Cloud project → enable the **Google Calendar API**.
2. Create an **OAuth 2.0 Client ID**, type *Web application*.
3. Authorised redirect URI, exactly:
   `https://portal.ownyourstudy.com/api/google/callback`
4. Consent screen scope: `https://www.googleapis.com/auth/calendar.events`
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, redeploy.
6. Each tutor connects their own calendar from **Profile**.

### AI notetaker

1. `RECALL_API_KEY` and `RECALL_REGION` from <https://recall.ai>.
2. Add a webhook pointing at
   `https://portal.ownyourstudy.com/api/webhooks/recall`, and set its signing
   secret as `RECALL_WEBHOOK_SECRET`.
3. `OPENAI_API_KEY` for the drafting step.
4. Turn the notetaker on in **Admin → Settings**, and record consent per
   student.

Recall's request and response shapes have changed between versions — check
`createBot` and `fetchTranscript` against their current docs on a throwaway
lesson before using it on a real one.

---

## Afterwards

**Deploying a change**

```bash
cd portal && npm run check && npm run cf:deploy
```

**Rolling back.** Cloudflare keeps previous versions: Workers & Pages → the
Worker → **Deployments** → roll back. Secrets are not versioned, so a rollback
does not undo a secret change.

**Staging.** `wrangler.jsonc` defines a second Worker:

```bash
npx wrangler deploy --env staging
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
```

Point it at a **separate Supabase project**. A staging deploy sharing the
production database can write to a real student's record.

**Logs.** `npx wrangler tail` streams live requests. Observability is on in
`wrangler.jsonc`, so the dashboard keeps them too.

---

## If something is wrong

| What you see | Usually |
| --- | --- |
| Demo notice on a real domain | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` not set, or set but not redeployed |
| Sign-in link goes nowhere | `/auth/callback` missing from Supabase redirect URLs |
| "Invitations cannot be sent" | `SUPABASE_SERVICE_ROLE_KEY` not set on the Worker |
| Webhook returns 503 | `RECALL_WEBHOOK_SECRET` not set — it refuses everything rather than accepting unsigned deliveries |
| Signed in, then signed out again | The proxy is not refreshing the session; see the note in `README.md` under Deployment |
| Empty dashboard for a real tutor | No assignment yet. **Admin → Assignments** is what grants access |
