# Own Your Study Portal

The private learning platform behind `ownyourstudy.com` — where students read
their lesson write-ups, tutors review and publish them, and administrators run
the practice. It deploys separately from the marketing site, at
`portal.ownyourstudy.com`.

```bash
cd portal
npm install
npm run dev          # http://localhost:3000 — runs on demo data with no setup
npm run preflight    # what is configured, what is missing, and what it costs
npm run cf:deploy    # build for Cloudflare Workers and ship it
```

**Going live for the first time?** [RUNBOOK.md](RUNBOOK.md) is the ordered path
from nothing to `portal.ownyourstudy.com`, with a checkpoint after each stage.
This file is the reference organised by topic.

With no environment variables at all the portal starts in **demo mode**: an
in-memory dataset with four sign-in-able people, twelve published lessons, a
transcript, a draft awaiting review and outstanding homework. Every screen and
every state can be walked through before a database exists. It is labelled as
demo data on every page and cannot reach a database, a model or a meeting.

---

## Contents

1. [Architecture](#architecture)
2. [Local setup](#local-setup)
3. [Supabase setup](#supabase-setup)
4. [Migrations](#migrations)
5. [Seed data](#seed-data)
6. [Setting up the team](#setting-up-the-team)
7. [Authentication](#authentication)
8. [Roles and access](#roles-and-access)
9. [Environment variables](#environment-variables)
10. [OpenAI integration](#openai-integration)
11. [Google Meet and Calendar](#google-meet-and-calendar)
12. [Recall.ai integration](#recallai-integration)
13. [Privacy, consent and retention](#privacy-consent-and-retention)
14. [Deployment](#deployment)
15. [Configuring portal.ownyourstudy.com](#configuring-portalownyourstudycom)
16. [Testing](#testing)
17. [What is deliberately not built yet](#what-is-deliberately-not-built-yet)

---

## Architecture

The marketing site is hand-written static HTML and CSS in the repository root
and the six `own-your-*/` practice sites. It has no build step and no server.
Nothing in this directory changes that: the portal is a separate Next.js
application in `portal/`, deployed to its own subdomain. The only edit made to
the public site was adding a **Log in** link to each navigation bar.

```
own your study/
├── index.html, index.css, tokens.css   the marketing site (unchanged)
├── own-your-*/                          the six practice sites (nav link only)
├── backend/                             the tutor-matching engine (untouched)
└── portal/                              ← this application
```

### Inside the portal

```
src/
├── app/
│   ├── (portal)/          everything behind the sign-in
│   │   ├── layout.tsx     resolves the session once, renders the shell
│   │   ├── student/       + layout.tsx role gate
│   │   ├── tutor/         + layout.tsx role gate
│   │   ├── admin/         + layout.tsx role gate
│   │   ├── parent/        + layout.tsx role gate
│   │   ├── lessons/[id]   role-agnostic link target, redirects appropriately
│   │   └── profile/
│   ├── login/             the only unauthenticated page
│   ├── auth/callback/     magic links and invitations land here
│   ├── api/webhooks/recall/
│   └── api/google/        connect + callback
├── components/
│   ├── ui/                primitives: buttons, badges, cards, states, icons
│   ├── portal/            domain components: lesson cards, transcript, review
│   └── auth/
├── lib/
│   ├── data/              the repository — see below
│   ├── actions/           server actions, each validating its own payload
│   ├── ai/                OpenAI lesson analysis
│   ├── meetings/          link parsing, the join window — both pure
│   ├── google/            OAuth, Calendar, Meet link creation
│   ├── recall/            meeting bot client, webhook verification, pipeline
│   ├── supabase/          browser, server and service-role clients
│   ├── auth/session.ts    who is signed in, and what they may reach
│   └── demo/              the in-memory dataset
├── proxy.ts               session refresh and the unauthenticated redirect
supabase/
├── migrations/            schema, RLS, storage, workflow functions
└── seed.sql               the same demo fiction, for a real database

wrangler.jsonc             the Cloudflare Worker: bindings, flags, public vars
open-next.config.ts        the Next → Worker build
.dev.vars.example          local secrets for the Worker runtime
```

### The repository pattern

Pages never talk to Supabase. They ask a `Repository` (`src/lib/data/repository.ts`),
which has two implementations:

| | `SupabaseRepository` | `DemoRepository` |
| --- | --- | --- |
| Used when | Supabase is configured | no credentials, or `NEXT_PUBLIC_PORTAL_DEMO_MODE=true` |
| Authorisation | the database's, via RLS | the same rules restated in TypeScript |
| Persistence | Postgres | memory, reset on restart |

The duplication in the demo implementation is deliberate. It makes "a tutor
cannot open an unassigned student" a property of the running application even
without a database, which is what `test/access.test.ts` exercises.

**Reads and writes fail differently, in both implementations.** An unauthorised
read returns `null` or an empty list, because that is exactly what Row Level
Security does — it filters rows; it does not announce that a row was withheld.
An unauthorised write throws, because silently discarding an edit is worse than
refusing it.

### Design

The portal uses the marketing site's own tokens rather than a new palette:
warm paper `#faf7f1`, midnight navy ink `#121a2f`, one indigo accent `#635bff`,
Fraunces over Inter, hairline rules at `#e4ddcd`, the same 4pt spacing scale.
They live in `src/app/globals.css` as a Tailwind `@theme` block, carried across
value-for-value from `tokens.css`.

---

## Local setup

```bash
cd portal
npm install
cp .env.example .env.local     # optional — the portal runs without it
npm run dev
```

Open <http://localhost:3000>. In demo mode the login page offers four accounts:

| Account | Role | What it shows |
| --- | --- | --- |
| Sophia Thompson | student | Two subjects, twelve published lessons, a transcript, outstanding homework |
| Theodora Kirby | tutor | Two assigned students and two write-ups waiting to be reviewed |
| Rowan Hale | admin | People, subjects, assignments, the lesson pipeline, the notetaker |
| Helen Thompson | parent | Read-only sight of one child |

A fifth person, **Marcus Adeyemi**, exists in the data but is not offered as a
sign-in. He is there so cross-student access can be tested: Sophia must not be
able to reach him, and Daniel — who teaches only maths — must not either.

Use the **Demo data** chip in the header to switch account.

---

## Supabase setup

1. Create a project at <https://supabase.com>.
2. **Project Settings → API** gives you the three Supabase values in
   `.env.example`. The anon key is public by design; the service-role key is
   not, and must never be given a `NEXT_PUBLIC_` prefix.
3. Run the migrations (below).
4. **Authentication → URL Configuration**: set the Site URL to your portal
   origin and add `<origin>/auth/callback` to the redirect allow-list. Magic
   links and invitations will not work otherwise.
5. **Authentication → Providers → Email**: enable it, and turn *off* public
   sign-ups. Accounts are created by admin invitation only.
6. Storage: the `lesson-files` bucket is created by the migration as a private
   bucket with a 25 MB limit. Nothing needs doing in the dashboard.

Once `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set,
demo mode switches itself off.

---

## Migrations

```
supabase/migrations/
├── 20260825090000_initial_schema.sql   tables, enums, triggers
├── 20260825091000_rls.sql              helpers, policies, the student view
├── 20260825092000_storage.sql          the private bucket and its policies
├── 20260825093000_workflow.sql         publish_lesson and friends
├── 20260826100000_google_calendar.sql  tutor Google connections, event ids
└── 20260903120000_question_banks.sql   question bank access, pooled hours
```

With the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Or paste each file, in filename order, into the SQL editor.

### The schema in one paragraph

`profiles` is one row per authenticated user and carries the role. `students`,
`tutors` and `parents` hold role-specific detail. `subjects` is the catalogue.
**`tutor_student_subjects` is the authorisation edge of the whole system**: a
tutor sees a student only through an active row there, and only in the subject
named. `lessons` hang off a (student, tutor, subject) triple; `transcripts`,
`lesson_notes`, `lesson_files` and `homework_items` hang off a lesson.
`student_topic_progress`, `notifications`, `webhook_events` and `app_settings`
support the rest.

### Two decisions worth knowing about

**Private notes are kept from students by row, not by column.** RLS filters
rows, so the only reliable way to withhold one column is to withhold the whole
row and offer a projection instead. `lesson_notes` is therefore readable by
tutors and admins only; students and parents read the
`student_lesson_notes` view, which has no `tutor_private_notes` column at all.
A future `select *` cannot leak it by accident. The view is created with
`security_invoker = false` and does its own authorisation in its `WHERE`
clause — flipping that setting would return nothing to students.

**Every policy expression goes through a `SECURITY DEFINER` helper.** A policy
that reads its own table recurses, and a policy that reads another table
silently applies that table's policies too. Wrapping each lookup in a small
definer function (`tutor_teaches_student_subject`, `can_read_published_lesson`,
and about a dozen more) makes the rules both terminating and predictable.

---

## Question banks

The IB question banks — 2,868 questions across fourteen banks, each with a full
worked solution — are the paid half of what `ownyourstudy.com/own-your-ib`
advertises. The marketing site publishes exactly one free question per bank and
does not contain the rest; the portal serves the rest to students who are
entitled to them.

**Where the questions live.** `src/data/question-banks/` and `src/data/papers/`,
imported by `src/lib/question-banks.ts` and `src/lib/papers.ts`. At 2 MB they
sit well inside Vercel's 250 MB serverless budget, so there is no store to
configure and no second place for the permission to be wrong.

Inside `src/`, deliberately: Next publishes `public/` to the browser, so
anything there is world-readable. Both modules are marked `server-only`, which
turns an accidental import from a client component into a build error rather
than a leak. Copy them in with `./tools/sync-portal-banks.sh` from the
repository root after regenerating; that script also copies the two viewers into
`public/question-bank/` and the stylesheet into `src/styles/`, so the portal
cannot drift from the marketing site.

> These briefly lived in a Cloudflare R2 bucket, on the mistaken belief that the
> portal deployed to a Workers script capped at 3 MiB. It deploys to **Vercel**
> — `wrangler.jsonc`, `open-next.config.ts` and the Cloudflare sections of this
> file and the RUNBOOK describe a deployment that is not the live one. The R2
> layer was solving a problem this deployment does not have.

**Demo mode never serves it.** Demo mode has no authentication worth the name —
its login page hands any role to anyone who clicks, and tutors pass the paid
gate. Anything deployed without Supabase secrets falls back to demo mode, so
without `paidContentAvailable()` in `src/lib/env.ts` such a deployment would
publish every question and every paper to whoever picked the tutor account. Set
`PORTAL_DEMO_PAID_CONTENT=true` to open it locally on purpose.

**Who may read them.** `question_bank_access` records a subscription; the
`has_question_bank_access()` function combines it with pooled hours, so there is
one answer whoever asks:

- an administrator grants it on the student's page, optionally with an expiry;
- or the student has at least `app_settings.question_bank_free_hours` (20 by
  default) hours of non-cancelled lessons booked, which is the promise the
  pricing page already makes.

There is no payments integration. When one arrives, its webhook writes this same
table and nothing else changes.

**What actually protects them** is `/api/question-banks/[file]`, which re-checks
on every request. The page-level check only decides what the page *says* — a
student who edits the markup in their browser gets a shelf they cannot load a
single question from. Files are looked up in a fixed map, so a path with `../`
in it is not a key rather than being a traversal to defend against.

The viewer itself is the marketing site's `qbank.js`, served from
`public/question-bank/` and mounted by `QuestionBankEmbed`. There is one
implementation of the filtering, marking and progress logic; what differs in the
portal is only where the data comes from.

## Seed data

`supabase/seed.sql` writes the same fiction as demo mode into a real database,
so the policies can be exercised against actual sessions.

```bash
# Mark the database as safe to seed — the script refuses otherwise.
psql "$DATABASE_URL" -c "comment on database postgres is 'own-your-study-dev';"
psql "$DATABASE_URL" -f supabase/seed.sql
```

Or `supabase db reset`, which runs the migrations and then this file.

Every seeded account uses the password **`ownyourstudy-dev`**. The guard at the
top of the file exists so that running it against production is an error rather
than an incident — it will not run unless the database carries a comment
containing `own-your-study-dev`.

---

## Setting up the team

`scripts/provision-team.mjs` creates the practice's staff accounts from a
roster, so the first six people do not have to be invited one at a time
through the interface.

```bash
cp scripts/team.example.json scripts/team.json   # then fill in the real emails
npm run team                                     # dry run — prints the plan
npm run team -- --send                           # actually invites them
```

Three things about it worth knowing.

**It does nothing by default.** Every row means a real email to a real person,
so the plain command prints what it would do and stops. `--send` is a separate,
typed decision rather than a flag you might leave set.

**It refuses a roster with any bad row**, rather than inviting five people and
failing on the sixth. Missing addresses, malformed ones, an unknown role and
duplicated emails are all reported together, before anything is sent.

**It is idempotent.** Anyone who already has an account is reported and skipped,
so adding one person to the roster and running it again is safe.

`scripts/team.json` is gitignored, because it holds people's contact details.

An admin with `"teaches": true` also gets a tutor record, which is what lets the
owner use the teaching pages — see below.

---

## Authentication

Supabase Auth, with two ways in:

- **Email and password** — the default.
- **Magic link** — the same form, one click across. `shouldCreateUser` is
  `false`, so an unknown address gets the same "check your email" screen and no
  account is created.

**Nobody signs themselves up.** An admin sends an invitation from
`/admin/students` or `/admin/tutors`; Supabase emails a one-time link; the
`handle_new_user` trigger creates the profile with the role carried in the
invitation's metadata, plus the matching `students`/`tutors`/`parents` row.
An unrecognised role falls back to `student`, the least-privileged one.

After sign-in, `/` resolves the role and redirects to that role's dashboard.

`src/proxy.ts` refreshes the session cookie and redirects unauthenticated
requests to `/login`. It is **not** the authorisation boundary — it runs on
every request with a cookie it cannot fully verify without a round trip. Role
enforcement is in the section layouts (a redirect) and, properly, in RLS (which
returns nothing).

---

## Roles and access

| | Student | Tutor | Admin | Parent |
| --- | --- | --- | --- | --- |
| Own profile | read/write | read/write | read/write | read |
| Other students | — | assigned only, per subject | all | linked children |
| Lessons | own, scheduled or published | own, any status | all | children's, published |
| Lesson notes | published, via the view | own lessons, editable | all | children's, published |
| Tutor's private notes | **never** | own | all | **never** |
| Transcripts | own, published, if enabled for them | own lessons | all | **never** |
| Files | own, published lessons | own lessons, upload | all | — |
| Join the meeting | own, in the window | own, in the window | — | **never** |
| Publish a lesson | — | own lessons | all | — |
| Create assignments | — | **no** | yes | — |

A tutor cannot assign themselves a student — that would make the whole model
self-serve. Only an admin creates a `tutor_student_subjects` row.

### The owner runs the practice and teaches in it

One person can hold the admin role and a tutor record at the same time. That
is what a practice this size actually looks like: the person who runs it also
takes lessons, and asking them to keep two logins to do both would be silly.

The tutor record is the test, not the role. `requireTeachingAccess()` lets in
anyone who is a tutor, plus any admin who has a tutor row — because that row is
what makes somebody assignable to a lesson. An admin without one has no
students of their own, nothing to show, and is sent back to the overview.

Their sidebar gains a **Teaching** group beneath the administrative links
rather than a role switcher. Running the practice and teaching in it are
different jobs; a flat list of eleven links presents them as one.

Nothing in RLS changed for this. An admin could already read every lesson; what
was missing was a tutor id in their session, so the teaching pages had nothing
to scope themselves to.

### The three home pages are deliberately different

Same design language, different shape, because the three roles arrive in
different modes and the page should meet them there.

| | Opens to | Treatment |
| --- | --- | --- |
| **Student** | a sentence about their own week | roomy reading surface: large greeting, one big next-lesson card, generous cards below |
| **Tutor** | a strip of four numbers to act on | working console: smaller greeting, day bar, review queue, today as a dense timetable |
| **Admin** | headline counts for the practice | reporting surface: large display numerals in a stat grid, then the pipeline |

The distinction is the point. A tutor and an administrator opening the portal
to the same furniture would mean neither page was doing its job — and a student
does not need a dashboard of metrics about themselves when a sentence says the
same thing more kindly.

Access is enforced in the database. Knowing a URL is worth nothing: an
unauthorised lesson id simply does not resolve, and there is no way to
distinguish "not yours" from "does not exist".

`scripts/check-isolation.sh` runs the cross-role checks against a live server —
either the dev server or the built Worker, which is worth doing separately
because they are different runtimes:

```bash
./scripts/check-isolation.sh
```

```bash
PORTAL_URL=http://localhost:8787 ./scripts/check-isolation.sh
```

---

## Environment variables

Everything is in `.env.example`. The short version:

| Variable | Required | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | for real use | demo mode |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for real use | demo mode |
| `SUPABASE_SERVICE_ROLE_KEY` | for webhooks and invitations | those two features refuse, with a clear message |
| `OPENAI_API_KEY` | for AI drafts | transcripts are still captured; tutors write up by hand |
| `OPENAI_MODEL` | no | defaults to `gpt-4.1` |
| `GOOGLE_CLIENT_ID` | for automatic Meet links | links are pasted in by hand |
| `GOOGLE_CLIENT_SECRET` | for automatic Meet links | as above |
| `RECALL_API_KEY` | for the notetaker | no bot is scheduled; lessons work normally |
| `RECALL_REGION` | no | defaults to `us-west-2` |
| `RECALL_WEBHOOK_SECRET` | for webhooks | **the webhook endpoint rejects every request** |
| `NEXT_PUBLIC_APP_URL` | in production | magic links point at the wrong origin |
| `NEXT_PUBLIC_MARKETING_URL` | no | defaults to `https://ownyourstudy.com` |
| `NEXT_PUBLIC_PORTAL_TIME_ZONE` | no | defaults to `Europe/London` |
| `NEXT_PUBLIC_PORTAL_DEMO_MODE` | no | forces demo mode even with credentials |

No secret is read anywhere a browser can see it. `SUPABASE_SERVICE_ROLE_KEY`,
`OPENAI_API_KEY` and the Recall keys are used only in files marked
`server-only` or in route handlers.

### A note on time zones

Every date and time in the portal renders in **one** zone for everybody,
`NEXT_PUBLIC_PORTAL_TIME_ZONE`. That is a deliberate V1 decision: a tutor in
London and a student in Singapore looking at "Thursday 18:00" must be looking
at the same moment. `students.timezone` exists in the schema for the day this
becomes per-person; when it does, `src/lib/timezone.ts` is the only file that
needs to change.

---

## OpenAI integration

`src/lib/ai/` turns a lesson transcript into a structured draft.

- `schema.ts` — the contract, written twice. A JSON Schema constrains the
  model's output; a Zod schema validates what comes back. Structured output
  makes malformed JSON very unlikely, not impossible, and a dashboard that
  crashes on `undefined.map()` is not an acceptable failure mode.
- `prompt.ts` — mostly a list of things not to do, because the failure modes of
  a model writing about a child's learning are predictable: inventing homework,
  inflating praise, diagnosing, and confusing a suggestion with an instruction.
- `analyze.ts` — the call. Server-only. Long transcripts are truncated from the
  middle, never the end, because the last ten minutes are where homework is set.

The prompt requires that every claim be supported by the transcript; that
`homework_assigned` contain only work the tutor explicitly set (an empty array
is a correct answer); that weaknesses be identified only where the transcript
shows them; and that nothing be said about intelligence, potential, personality
or wellbeing. Student-facing text is written in the second person, specific and
evidence-based, in British English.

**Nothing it produces is ever shown to a student without a tutor publishing it.**

---

## Google Meet and Calendar

Every lesson needs a meeting link, and the two ways to get one are handled
differently on purpose.

### Pasting a link in

This always works and needs no configuration. The field accepts what people
actually paste — a full Meet, Zoom or Teams URL, a URL with the scheme missing,
a bare Meet code like `abc-defg-hij`, or a link still wrapped in a calendar's
redirector. `src/lib/meetings/links.ts` normalises all of it to one canonical
URL, strips tracking parameters while keeping the ones that matter (Zoom's
`pwd`, Teams' `context`), and reads the meeting code out for display.

**The platform is detected from the link, never chosen separately.** There is
no platform dropdown, because a dropdown that can disagree with the URL beside
it is a field whose only job is to be wrong occasionally.

### Letting the portal create one

With `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set, a tutor can connect
their own Google account from **Profile → Google Calendar**. Scheduling a
lesson then creates a real calendar event with a Meet link attached and invites
the student, so the lesson is in both diaries with the link already in it.

Setting it up:

1. In a Google Cloud project, enable the **Google Calendar API**.
2. Create an **OAuth 2.0 Client ID**, type *Web application*.
3. Add the redirect URI exactly: `<NEXT_PUBLIC_APP_URL>/api/google/callback`.
4. On the consent screen, add the scope
   `https://www.googleapis.com/auth/calendar.events`.
5. Put the client id and secret in the environment.

Four decisions worth knowing about.

**The connection is per tutor, not per organisation.** The lesson lands in the
diary of the person teaching it, the invitation comes from them, and they host
the Meet — so they are the host when they arrive, rather than a student sitting
alone in a meeting nobody is running.

**The scope is `calendar.events`, not `calendar`.** The portal can manage the
events it created and cannot read the rest of somebody's diary.

**Refresh tokens are unreadable through the API.** `google_accounts` has RLS on
and *no select policy at all* — not for the owner, not for an administrator.
Only the service role reads them. What a person can see is
`google_connection_status`, a view that does not contain the token column. It
is the same reasoning that keeps a tutor's private notes away from students:
the reliable way to withhold a column is to withhold the row.

**Google comes second.** The lesson is written to the database first and Google
is asked afterwards, so an outage at Google costs a meeting link rather than a
booking. A failure is reported as a warning on a successful create — never as
an error, which would make the tutor book the lesson twice.

Moving or cancelling a lesson updates or cancels the calendar event, but only
for events the portal made (`lessons.meet_link_managed`). A pasted link belongs
to whoever made it and is left alone.

### Meeting links on the tutor dashboard

The tutor's home page carries two lesson sections, and they do different jobs.

**Today** is a timetable: time-led rows, in order, each with its meeting code
and a join button that goes live on its own when the window opens.

**Coming up — meeting links** covers everything after today, and is a worklist
rather than a lesson list. Its window is deliberately wider than *Coming up*
further down the page, because a lesson without a link is almost never the next
one — it is the one booked a fortnight ago that nobody has got to yet. Those
rows are tinted and carry a **Create Meet link** button that mints one on the
spot. Every row says whether the link was created by the portal or added by
hand, because only the first is one the portal can move or revoke.

The two never list the same lesson, which is why the second one starts after
today rather than simply showing the next six.

Creating a link after the fact goes through `generateMeetLink()`, the same path
scheduling uses. It refuses to overwrite a link that is already there: replacing
one somebody pasted in would strand whoever already has it, and from a dashboard
button you cannot see which of those two things you are about to do.

### The join gate

Every "Join lesson" control points at `/lessons/<id>/join`, not at the meeting.

That route checks entitlement and the clock **at the moment of the click**, and
only then sends the person on. So a page left open in a tab since yesterday
cannot be used by someone whose access has since been revoked; the meeting URL
never has to travel in a notification or an email; and when joining is not
possible the reader gets a sentence — *"the link opens ten minutes before the
lesson"* — instead of a dead click.

The link is live from ten minutes before the start until thirty minutes after
the scheduled end (lessons overrun), and never for a cancelled lesson or one
that has already been written up. This is a courtesy, not a security boundary:
anyone who saved the underlying URL can still use it. What it guarantees is
that the portal never presents a stale link as if it were live. The
consequential checks are in RLS.

Both pieces are pure and tested in `test/meeting-links.test.mts`.

## Recall.ai integration

`src/lib/recall/` is a real HTTP client, not a simulation. With no
`RECALL_API_KEY` every method throws `RecallNotConfiguredError`, the UI says so
plainly, and lessons carry on working without a transcript. Nothing anywhere
pretends a bot was scheduled.

```
lesson scheduled
  → consent checked          notetaker_consent_blockers(), and again in the action
  → bot created              createBot() — joins under a disclosing name
  → bot joins the meeting
  → transcript produced
  → webhook received         POST /api/webhooks/recall, signature verified
  → transcript stored        media is not retained
  → OpenAI analysis runs
  → lesson marked review_required, tutor notified
  → tutor edits and publishes
```

The webhook endpoint has four properties worth stating:

- **Verified.** The raw body is checked against the Svix signature *before* it
  is parsed. With no `RECALL_WEBHOOK_SECRET` it refuses everything — an open
  endpoint that writes transcripts into student records is not a state worth
  degrading into.
- **Idempotent.** Each delivery is recorded in `webhook_events` under a unique
  `(provider, event_id)`. Redelivery is acknowledged and dropped, so no
  transcript is analysed twice. The unique index is the guard, not a
  check-then-act.
- **Quiet.** Only ids and event names are logged. Transcript text never reaches
  an application log.
- **Always 2xx once accepted.** A 5xx makes Recall retry, and a retry of an
  event already recorded achieves nothing. Failures are written to the lesson
  and surfaced in `/admin/lessons?status=failed`.

### To activate it

1. Get an API key from <https://recall.ai> and set `RECALL_API_KEY` and
   `RECALL_REGION`.
2. Add a webhook in the Recall dashboard pointing at
   `https://portal.ownyourstudy.com/api/webhooks/recall`, and put its signing
   secret in `RECALL_WEBHOOK_SECRET`.
3. Turn the notetaker on in **Admin → Settings**.
4. Record consent on each student's record.

⚠ **Check the request and response shapes before going live.** Recall's API has
changed between versions. The endpoints and auth scheme in `client.ts` follow
their v1 API and the parsing is defensive, but `createBot` and `fetchTranscript`
should be checked against the current docs with a real key in hand. The webhook
handler does not depend on those shapes. `toSegments`, the part most likely to
need adjusting, is pure and covered by `test/recall-transcript.test.ts`.

---

## Privacy, consent and retention

Lessons involve minors, and the system is built accordingly.

**Consent is explicit and per-student.** Four flags on `students`:
`ai_notetaker_consent`, `transcription_consent`, `guardian_consent_required`
and `guardian_consent_received`, plus `consent_timestamp`. A bot is created
only when all applicable flags are set *and* the organisation switch is on.
The check exists in two places — `notetaker_consent_blockers()` in SQL and
`consentBlockers()` in the scheduling action — because the cost of the check is
nothing and the cost of getting it wrong is recording a child without
permission.

**Accepting general terms is not consent to record a lesson.** The interface
says so on the student record. These flags record a decision; they are not by
themselves proof that valid consent was obtained, and you should keep your own
record of how each permission was given and by whom.

**No hidden recording.** The bot appears in the participant list under a name
that says what it is, configurable in Admin → Settings and defaulting to
"Own Your Study AI Notetaker".

**Media is not retained.** The intended product is not a video library:

```
meeting media → temporary processing → speaker-labelled transcript
→ AI lesson notes → keep the transcript and the notes → discard the video
```

`media_retention_hours` (default 24) records the intent, and no part of the
portal stores or serves a playable recording. **Retention is not yet enforced
by a scheduled job** — see below.

**Files are private.** The `lesson-files` bucket is not public. URLs are minted
as ten-minute signed URLs at read time and never stored, so a link forwarded a
week later is dead.

---

## Deployment

The whole network lives on Cloudflare: the marketing site is a static upload to
Pages, and the portal is a Worker on its own subdomain. They deploy separately
and on separate schedules.

```bash
npm run check       # lint, typecheck, tests, production build
npm run cf:preview  # build for Workers and run it locally on workerd
npm run cf:deploy   # build and ship it
```

### Why a Worker and not a static upload

The marketing site has no server, so Pages is exactly right for it. The portal
holds sessions, queries Supabase, verifies webhook signatures and calls Google
— it needs somewhere to run code on every request. On Cloudflare that is
Workers, and the build is produced by
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), which turns a
normal `next build` into a Worker bundle.

Nothing about the application is Cloudflare-specific. `next build`,
`next start` and every test still work unchanged, so moving to a plain Node
host later means deleting three files rather than unpicking an architecture.

### First deploy

```bash
cd portal
npx wrangler login
npm run cf:deploy
```

That publishes to `own-your-study-portal.<your-subdomain>.workers.dev`. It will
come up in **demo mode**, because no secrets are set yet — which is a useful
first checkpoint: the deployment works before any real data is near it.

### Secrets

`wrangler.jsonc` holds only public configuration. Everything sensitive goes in
one at a time, and never into the repo:

```bash
npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put RECALL_API_KEY
npx wrangler secret put RECALL_WEBHOOK_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

The two `NEXT_PUBLIC_SUPABASE_*` values are not secret — they are compiled into
the client bundle either way — but they are set here rather than in
`wrangler.jsonc` so that switching a deployment between projects is one command
and not an edit to a tracked file. Setting the first two is what takes the
portal out of demo mode.

`OPENAI_MODEL`, `RECALL_REGION` and the `NEXT_PUBLIC_*` URLs live in the `vars`
block of `wrangler.jsonc`, because they are configuration rather than
credentials and are worth seeing in a diff.

### Running the Worker locally

`npm run dev` runs Next in Node, which is the fast loop and what you want most
of the time. `npm run cf:preview` builds the Worker and runs it on **workerd**,
the same runtime Cloudflare uses — which is the only way to catch something
that works in Node and not in production.

It reads `.dev.vars` rather than `.env.local`; copy `.dev.vars.example` and
fill in what you need. Both files are gitignored.

The access-control suite can be pointed at either:

```bash
PORTAL_URL=http://localhost:8787 ./scripts/check-isolation.sh
```

### What was verified on workerd

Not assumed — run against the built Worker:

- **`node:crypto` works.** Three modules depend on it: the Recall webhook's
  HMAC verification and the signing and reading of the Google OAuth state. A
  forged webhook signature was correctly rejected with a real digest
  comparison, which exercises `createHmac`, `Buffer` and `timingSafeEqual`.
  This needs the `nodejs_compat` flag, which is set in `wrangler.jsonc` — remove
  it and the webhook fails closed and transcripts silently stop arriving.
- **The proxy runs.** Unauthenticated requests get a 307 to `/login`.
- **All 21 isolation checks pass** on the Worker, including the join gate.
- **Pages render identically**, checked at desktop, tablet and mobile.

### One thing to keep an eye on

`src/proxy.ts` runs on the Node.js runtime, which is the only option — Next 16
removed the ability to choose a runtime for Proxy, and setting one throws. The
Cloudflare adapter prints a warning that Node middleware support is
experimental there.

It works, and the redirect behaviour is verified above. But the proxy is
load-bearing for a reason worth knowing: it is what refreshes the Supabase
session cookie. A Server Component cannot write cookies, so
`createSupabaseServerClient` silently swallows the refresh — the proxy is the
only place the rotated token gets written back. If it ever stops running,
sessions expire instead of renewing, and the symptom is users being logged out
rather than an error in a log. Worth an explicit check after any adapter
upgrade: sign in, wait past the access-token lifetime, and confirm you are
still signed in.

### Staging

`wrangler.jsonc` defines a `staging` environment as a separate Worker with its
own secrets, so point it at a separate Supabase project and a staging deploy
can never write to a real student's record.

```bash
npx wrangler deploy --env staging
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
```

### The marketing site is unaffected

It keeps its own pipeline: `./build.sh`, then upload `dist/` to Cloudflare
Pages, exactly as `DEPLOY.md` describes. `build.sh` only matches `own-your-*/`,
so it never picks the portal up.

---

## Configuring `portal.ownyourstudy.com`

The domain is already on Cloudflare, which makes this short.

1. In the Cloudflare dashboard, open the `own-your-study-portal` Worker →
   **Settings → Domains & Routes → Add → Custom domain**, and enter
   `portal.ownyourstudy.com`.
2. That is the whole DNS step. Because the zone is on the same account,
   Cloudflare creates the record and issues the certificate itself — there is
   no CNAME to add by hand and no grey-cloud decision to get wrong.
3. Set the app URL to match, so magic links and the invite links the portal
   hands out point at the right origin. It lives in the `vars` block of
   `wrangler.jsonc`:

   ```jsonc
   "vars": { "NEXT_PUBLIC_APP_URL": "https://portal.ownyourstudy.com" }
   ```

   Then redeploy — `vars` are applied at deploy time, not at runtime.
4. In Supabase → **Authentication → URL Configuration**, set the Site URL to
   `https://portal.ownyourstudy.com` and add
   `https://portal.ownyourstudy.com/auth/callback` to the redirect allow-list.
   Sign-in links break silently otherwise.
5. In the Google Cloud OAuth client, add
   `https://portal.ownyourstudy.com/api/google/callback` to the authorised
   redirect URIs. It must match exactly, including the scheme.
6. Point the Recall webhook at
   `https://portal.ownyourstudy.com/api/webhooks/recall`.

The **Log in** links already in the marketing navigation point at
`https://portal.ownyourstudy.com`, so they start working the moment the
subdomain resolves.

---

## Testing

```bash
npm run lint        # eslint, via eslint-config-next
npm run typecheck   # tsc --noEmit, strict, noUncheckedIndexedAccess
npm test            # node --test, no test-runner dependency
npm run build       # production build
npm run check       # all four
```

`test/access.test.mts` (35 tests) exercises the access rules through the demo
repository: cross-student reads, cross-subject tutor reads, private notes,
unreviewed drafts, the publish workflow and homework ownership.
`test/meeting-links.test.mts` covers meeting-link parsing and the join window.
`test/recall-transcript.test.mts` covers the Recall payload mapping. 59 in all.

The tests run the TypeScript sources directly — Node's type stripping plus a
small resolver hook in `test/alias-hooks.mjs` for the `@/` alias. There is no
build step and no test framework to keep up to date.

**What the tests do not cover:** the RLS policies themselves. They are
reviewed, and the demo repository mirrors them, but SQL is only truly tested by
a database. Before production, run `supabase db reset`, sign in as each seeded
account, and confirm each row of the access table above by hand.

---

## What is deliberately not built yet

Architected for, not implemented. Each is a real feature, not a stub pretending
to be one.

- **Ask Own Your Study AI** — "what did my tutor explain about SN1 last week?".
  The transcripts are stored as addressable segments (`#t-<index>` deep links
  already work), which is the retrieval substrate this needs.
- **The parent dashboard** is intentionally thin: lessons attended, what was
  covered, homework, what is next. No transcript, no tutor notes. Widening it
  should be a deliberate decision, not a default.
- **Live whiteboard.** `FileList` renders boards as images and PDFs today. A
  tldraw canvas would slot in as another file category rendered by the same
  component.
- **Paying for question bank access.** The entitlement is recorded and enforced;
  taking the money is not. An administrator ticks the box when a subscription is
  paid. A Stripe webhook writing `question_bank_access` is the whole of what
  self-serve would add.
- **Recurring lessons.** Google Calendar events are created one at a time; the
  API's `recurrence` field is where a weekly slot would go.
- **Two-way calendar sync.** The portal writes to Google; it does not watch for
  a tutor moving the event in Google and writing that back. Calendar push
  notifications are the mechanism if this becomes worth doing.
- **Mastery scoring.** `student_topic_progress` exists and the demo data fills
  it in, but nothing writes a defensible value and the UI says so wherever a
  number appears. It is waiting on scored assessments; conversation is not
  evidence of mastery and the product should not imply otherwise.
- **Retention enforcement.** `transcript_retention_days` and
  `media_retention_hours` are recorded and shown but no scheduled job deletes
  anything yet. A Supabase cron job or a scheduled function should be added
  before the first retention period elapses.
- **Notification delivery.** Notifications are database records rendered in the
  header. No email, no push, no realtime.
- **Billing, attendance, tutor analytics, student goals.**
