import Link from "next/link";
import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { StatCard } from "@/components/portal/stat-card";
import { AlertIcon, ShieldIcon, SparkIcon } from "@/components/ui/icons";
import { Badge, Card, Rule, SectionHead } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { googleStatus, isDemoMode, openAiStatus, recallStatus } from "@/lib/env";
import { PROCESSING } from "@/lib/status";

export const metadata: Metadata = { title: "AI Notetaker" };
export const dynamic = "force-dynamic";

/* The page that answers "is the notetaker on, and is it working?" — including
   the honest answer when the credentials for it are not present. */
export default async function AdminNotetaker() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [settings, students, processing, failed, review] = await Promise.all([
    repo.getSettings(),
    repo.listStudents(),
    repo.listLessons({ status: PROCESSING, order: "desc", limit: 10 }),
    repo.listLessons({ status: "failed", order: "desc", limit: 10 }),
    repo.listLessons({ status: "review_required", order: "desc", limit: 10 }),
  ]);

  const recall = recallStatus();
  const openai = openAiStatus();
  const google = googleStatus();

  const consentReady = students.filter(
    (s) =>
      s.consent.aiNotetakerConsent &&
      s.consent.transcriptionConsent &&
      (!s.consent.guardianConsentRequired || s.consent.guardianConsentReceived),
  );

  return (
    <div className="space-y-12">
      <SectionHead
        as="h1"
        eyebrow="Own Your Study AI Notetaker"
        title="The notetaker"
        description="A named participant joins the meeting, produces a speaker-labelled transcript, and drafts a write-up for the tutor to review. It never publishes anything itself."
      />

      <section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Organisation switch"
            value={settings.notetakerEnabledGlobally ? "On" : "Off"}
            detail="Set in Settings"
            href="/admin/settings"
          />
          <StatCard
            label="Consent complete"
            value={`${consentReady.length}/${students.length}`}
            detail="Students the bot may join"
            href="/admin/students"
          />
          <StatCard label="In processing" value={processing.length} />
          <StatCard
            label="Needs attention"
            value={failed.length}
            tone="warning"
            href="/admin/lessons?status=failed"
          />
        </div>
      </section>

      <section>
        <SectionHead title="Connections" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">Recall.ai — meeting bot</p>
                <p className="mt-1 text-sm text-ink-500">{recall.detail}</p>
              </div>
              <Badge tone={recall.configured ? "success" : "neutral"}>
                {recall.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            {!recall.configured ? (
              <div className="mt-4 rounded-[10px] border border-rule bg-paper-2/60 p-4 text-sm text-ink-700">
                <p className="font-medium text-ink">What is missing</p>
                <p className="mt-1.5">
                  Set <code className="rounded bg-paper-3 px-1">RECALL_API_KEY</code>,{" "}
                  <code className="rounded bg-paper-3 px-1">RECALL_REGION</code> and{" "}
                  <code className="rounded bg-paper-3 px-1">RECALL_WEBHOOK_SECRET</code>, then point
                  a Recall webhook at{" "}
                  <code className="rounded bg-paper-3 px-1">/api/webhooks/recall</code>. Everything
                  around the integration is built; only the credentials are absent.
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">OpenAI — lesson analysis</p>
                <p className="mt-1 text-sm text-ink-500">{openai.detail}</p>
              </div>
              <Badge tone={openai.configured ? "success" : "neutral"}>
                {openai.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            {!openai.configured ? (
              <div className="mt-4 rounded-[10px] border border-rule bg-paper-2/60 p-4 text-sm text-ink-700">
                <p className="font-medium text-ink">What is missing</p>
                <p className="mt-1.5">
                  Set <code className="rounded bg-paper-3 px-1">OPENAI_API_KEY</code>. Without it a
                  transcript is still captured and stored — the tutor simply writes the lesson up
                  themselves rather than editing a draft.
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">Google Calendar — meeting links</p>
                <p className="mt-1 text-sm text-ink-500">{google.detail}</p>
              </div>
              <Badge tone={google.configured ? "success" : "neutral"}>
                {google.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            <div className="mt-4 rounded-[10px] border border-rule bg-paper-2/60 p-4 text-sm text-ink-700">
              {google.configured ? (
                <>
                  <p className="font-medium text-ink">Per tutor, not per organisation</p>
                  <p className="mt-1.5">
                    Each tutor connects their own calendar from their profile. The lesson then
                    lands in their diary and the student&rsquo;s, and the Meet link is hosted by
                    the person actually teaching. Nothing here connects on their behalf.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-ink">What is missing</p>
                  <p className="mt-1.5">
                    Set <code className="rounded bg-paper-3 px-1">GOOGLE_CLIENT_ID</code> and{" "}
                    <code className="rounded bg-paper-3 px-1">GOOGLE_CLIENT_SECRET</code>, and add{" "}
                    <code className="rounded bg-paper-3 px-1">/api/google/callback</code> to the
                    OAuth client&rsquo;s redirect URIs. Lessons work without it; meeting links are
                    pasted in by hand.
                  </p>
                </>
              )}
            </div>
          </Card>
        </div>

        {isDemoMode() ? (
          <p className="mt-4 flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning-wash px-4 py-3 text-sm text-warning">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            The portal is in demo mode, so no bot can be scheduled and no webhook can be accepted
            whatever these keys say.
          </p>
        ) : null}
      </section>

      <section>
        <SectionHead title="How a lesson becomes notes" />
        <Card>
          <ol className="space-y-4">
            {[
              ["Lesson scheduled", "A tutor books a lesson and asks for the notetaker."],
              [
                "Consent checked",
                "The bot is only created if the student, and where required their guardian, have consented and the organisation switch is on.",
              ],
              [
                "Bot joins",
                `It appears in the participant list as "${settings.notetakerDisplayName}". There is no hidden recording.`,
              ],
              [
                "Transcript produced",
                `Speaker-labelled, then stored against the lesson${settings.transcriptRetentionDays > 0 ? ` and removed after ${settings.transcriptRetentionDays} days` : ""}.`,
              ],
              [
                "No media kept",
                "The bot is asked for a transcript and nothing else, so no audio or video ever reaches the portal. There is no recording to play back and none to delete.",
              ],
              ["Draft written", "The transcript is analysed into a structured write-up."],
              [
                "Tutor reviews",
                "The lesson is marked Review required and the tutor is notified. Nothing is visible to the student.",
              ],
              ["Tutor publishes", "Only a person can take this step."],
            ].map(([title, detail], i) => (
              <li key={title} className="flex gap-4">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper-2 text-xs font-semibold text-ink-500"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-ink">{title}</p>
                  <p className="mt-0.5 text-sm text-ink-500">{detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <Rule className="my-6" />

          <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-500">
            <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" />
            The consent flags in this system record a decision — they are not, by themselves, legal
            advice or proof that valid consent was obtained. Because lessons involve minors, keep
            your own record of how each permission was given and by whom.
          </p>
        </Card>
      </section>

      {review.length > 0 || processing.length > 0 || failed.length > 0 ? (
        <section>
          <SectionHead title="Lessons in the pipeline" />
          <div className="space-y-8">
            {[
              ["Processing", processing],
              ["Waiting on a tutor", review],
              ["Needs attention", failed],
            ]
              .filter(([, list]) => (list as unknown[]).length > 0)
              .map(([label, list]) => (
                <div key={label as string}>
                  <h3 className="eyebrow mb-3">{label as string}</h3>
                  <ul className="space-y-3">
                    {(list as typeof processing).map((lesson) => (
                      <LessonCard key={lesson.id} lesson={lesson} role="admin" audience="tutor" />
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </section>
      ) : (
        <section>
          <SectionHead title="Lessons in the pipeline" />
          <Card>
            <p className="flex items-center gap-2 text-sm text-ink-500">
              <SparkIcon className="h-4 w-4 text-ink-300" />
              Nothing in flight. Lessons appear here between the meeting ending and the tutor
              publishing.
            </p>
          </Card>
        </section>
      )}

      <p className="text-sm text-ink-300">
        Retention and the organisation switch are on the{" "}
        <Link href="/admin/settings" className="font-medium text-ink-500 hover:text-accent hover:underline">
          Settings
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
