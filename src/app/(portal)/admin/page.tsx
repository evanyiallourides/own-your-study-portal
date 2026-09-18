import Link from "next/link";
import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { StatCard } from "@/components/portal/stat-card";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Badge, Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { greeting } from "@/lib/format";
import { openAiStatus, paymentsStatus, recallStatus, wiseStatus, isDemoMode } from "@/lib/env";
import { NEEDS_REVIEW, PROCESSING } from "@/lib/status";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [counts, review, processing, failed, settings] = await Promise.all([
    repo.adminCounts(),
    repo.listLessons({ status: NEEDS_REVIEW, order: "desc", limit: 6 }),
    repo.listLessons({ status: PROCESSING, order: "desc", limit: 6 }),
    repo.listLessons({ status: "failed", order: "desc", limit: 6 }),
    repo.getSettings(),
  ]);

  const openai = openAiStatus();
  const recall = recallStatus();
  const stripePayments = paymentsStatus();
  const wisePayments = wiseStatus();

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">
          {greeting()}, {session.profile.firstName || "there"}
        </h1>
        <p className="mt-2 text-lg text-ink-500">How the practice is running today.</p>
      </header>

      <section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Students"
            value={counts.students ?? 0}
            detail={`${counts.active_students ?? 0} active`}
            href="/admin/students"
          />
          <StatCard label="Tutors" value={counts.tutors ?? 0} href="/admin/tutors" />
          <StatCard
            label="Lessons this month"
            value={counts.lessons_this_month ?? 0}
            href="/admin/lessons"
          />
          <StatCard
            label="Requiring review"
            value={counts.review_required ?? 0}
            detail="Waiting on a tutor"
            tone="warning"
            href="/admin/lessons?status=review_required"
          />
        </div>
      </section>

      <section>
        <SectionHead
          title="Pipeline"
          description="Where lessons currently sit between the meeting ending and the notes reaching the student."
        />
        <div className="space-y-8">
          <div>
            <h3 className="eyebrow mb-3">Waiting on a tutor</h3>
            {review.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing waiting. Every write-up is published.</p>
            ) : (
              <ul className="space-y-3">
                {review.map((lesson) => (
                  <LessonCard key={lesson.id} lesson={lesson} role="admin" audience="tutor" />
                ))}
              </ul>
            )}
          </div>

          {processing.length > 0 ? (
            <div>
              <h3 className="eyebrow mb-3">In processing</h3>
              <ul className="space-y-3">
                {processing.map((lesson) => (
                  <LessonCard key={lesson.id} lesson={lesson} role="admin" audience="tutor" />
                ))}
              </ul>
            </div>
          ) : null}

          {failed.length > 0 ? (
            <div>
              <h3 className="eyebrow mb-3">Needs attention</h3>
              <ul className="space-y-3">
                {failed.map((lesson) => (
                  <LessonCard key={lesson.id} lesson={lesson} role="admin" audience="tutor" />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <SectionHead
          title="Integrations"
          description="What is actually connected. Nothing here is simulated."
          action={
            <Link
              href="/admin/notetaker"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
            >
              AI Notetaker
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Database</p>
              <Badge tone={isDemoMode() ? "warning" : "success"}>
                {isDemoMode() ? "Demo data" : "Supabase"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">
              {isDemoMode()
                ? "No Supabase project configured. Everything on screen is invented sample data."
                : "Connected. Access is enforced by Row Level Security."}
            </p>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Lesson analysis</p>
              <Badge tone={openai.configured ? "success" : "neutral"}>
                {openai.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">{openai.detail}</p>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Meeting notetaker</p>
              <Badge tone={recall.configured ? "success" : "neutral"}>
                {recall.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">{recall.detail}</p>
            {!settings.notetakerEnabledGlobally ? (
              <p className="mt-2 text-sm text-warning">
                Switched off for the organisation in Settings.
              </p>
            ) : null}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Payments — AUD (Stripe)</p>
              <Badge tone={stripePayments.configured ? "success" : "neutral"}>
                {stripePayments.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">{stripePayments.detail}</p>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Payments — USD/EUR/GBP (Wise)</p>
              <Badge tone={wisePayments.configured ? "success" : "neutral"}>
                {wisePayments.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">{wisePayments.detail}</p>
          </Card>
        </div>
      </section>

      {counts.students === 0 ? (
        <EmptyState
          title="Nobody in the system yet"
          description="Invite a tutor and a student, create a subject, then assign the tutor to the student in that subject. That assignment is what grants access."
        />
      ) : null}
    </div>
  );
}
