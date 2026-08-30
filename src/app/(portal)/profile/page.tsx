import type { Metadata } from "next";

import { GoogleConnectionCard } from "@/components/portal/google-connection";
import { Button } from "@/components/ui/primitives";
import { Badge, Card, KeyValue, Rule, SectionHead } from "@/components/ui/primitives";
import { signOut } from "@/lib/actions/auth";
import { requireSession } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { googleStateFor } from "@/lib/google/status";
import { ROLE_LABEL } from "@/lib/navigation";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const session = await requireSession();
  const repo = await repositoryFor(session);
  const { google: googleNotice } = await searchParams;

  const student = session.studentId ? await repo.getStudent(session.studentId).catch(() => null) : null;

  /* Only the people who run lessons are offered a calendar connection. A
     student's own Google account is not something this product should ask
     for, and a parent has nothing to put in a calendar. */
  const runsLessons = session.profile.role === "tutor" || session.profile.role === "admin";
  const google = runsLessons ? await googleStateFor(session.profile.id) : null;

  return (
    <div className="max-w-2xl space-y-10">
      <SectionHead as="h1" title="Profile" description="Your account and what it can see." />

      <Card>
        <dl className="grid gap-5 sm:grid-cols-2">
          <KeyValue label="Name">{session.profile.fullName}</KeyValue>
          <KeyValue label="Email">{session.profile.email}</KeyValue>
          <KeyValue label="Role">
            <Badge tone="accent">{ROLE_LABEL[session.profile.role]}</Badge>
          </KeyValue>
          {student ? <KeyValue label="Timezone">{student.timezone}</KeyValue> : null}
        </dl>
        <p className="mt-5 text-sm text-ink-300">
          Names and roles are managed by your coordinator. If something here is wrong, ask them to
          correct it.
        </p>
      </Card>

      {student ? (
        <section>
          <SectionHead
            title="Recording and transcription"
            description="What you have agreed to. Ask your coordinator to change any of it."
          />
          <Card>
            <ul className="space-y-3">
              {[
                ["AI Notetaker may join my lessons", student.consent.aiNotetakerConsent],
                ["My lessons may be transcribed", student.consent.transcriptionConsent],
                [
                  "Guardian consent",
                  student.consent.guardianConsentRequired
                    ? student.consent.guardianConsentReceived
                    : true,
                ],
                ["I can read my own transcripts", student.transcriptAccessEnabled],
              ].map(([label, value]) => (
                <li key={String(label)} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-700">{label as string}</span>
                  <Badge tone={value ? "success" : "neutral"}>{value ? "Yes" : "No"}</Badge>
                </li>
              ))}
            </ul>
            {student.consent.consentTimestamp ? (
              <p className="mt-5 text-sm text-ink-300">
                Last recorded {formatDate(student.consent.consentTimestamp)}.
              </p>
            ) : null}
          </Card>
        </section>
      ) : null}

      {google ? <GoogleConnectionCard state={google} notice={googleNotice} /> : null}

      <Rule />

      <form action={signOut}>
        <Button type="submit" variant="outline">
          Log out
        </Button>
      </form>
    </div>
  );
}
