import Link from "next/link";
import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { StatCard } from "@/components/portal/stat-card";
import { hoursLabel } from "@/components/portal/student-records";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Badge, Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { greeting } from "@/lib/format";
import { CURRENCIES } from "@/lib/catalogue";
import { openAiStatus, paymentsStatus, recallStatus, wiseStatus, isDemoMode } from "@/lib/env";
import { btcPayConfig } from "@/lib/payments/btcpay";
import { providerFor } from "@/lib/payments/provider";
import { NEEDS_REVIEW, PROCESSING } from "@/lib/status";
import { isLowOnHours, isUnmatched, planNeedsAttention } from "@/lib/types";

/** "AUD, EUR" — which currencies each provider takes, from the one rule that decides it. */
function currenciesFor(provider: "stripe" | "wise"): string {
  return CURRENCIES.filter((c) => providerFor(c) === provider)
    .map((c) => c.toUpperCase())
    .join(", ");
}

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [counts, review, processing, failed, settings, orders, escalated, students, balances, plans] =
    await Promise.all([
      repo.adminCounts(),
      repo.listLessons({ status: NEEDS_REVIEW, order: "desc", limit: 6 }),
      repo.listLessons({ status: PROCESSING, order: "desc", limit: 6 }),
      repo.listLessons({ status: "failed", order: "desc", limit: 6 }),
      repo.getSettings(),
      /* The rest are swallowed: a database behind on a migration should still
         show the owner the lesson pipeline, which is the part that runs daily. */
      repo.listOrders().catch(() => []),
      repo.listIaSubmissions({ escalatedOnly: true }).catch(() => []),
      repo.listStudents().catch(() => []),
      repo.listHourBalances().catch(() => []),
      repo.listStudyPlans().catch(() => []),
    ]);

  /* -- What needs the owner, as opposed to a tutor --------------------------
     Money that has arrived with nobody to give it to, an instalment that
     failed, a student about to run out of hours, a person-read IA review that
     was asked for, and students with no plan. Each links to where it is
     resolved. */
  const unmatched = orders.filter(isUnmatched);
  const pastDue = orders.filter((o) => o.status === "past_due");
  const pendingWise = orders.filter((o) => o.provider === "wise" && o.status === "pending");
  const activeStudents = students.filter((s) => s.profile.active);
  const nameOf = (id: string) => students.find((s) => s.id === id)?.profile.fullName ?? "A student";
  const lowOnHours = balances
    .filter((b) => isLowOnHours(b) && activeStudents.some((s) => s.id === b.studentId))
    .sort((a, b) => a.remainingMinutes - b.remainingMinutes);
  const withoutPlan = activeStudents.filter((s) =>
    planNeedsAttention(plans.find((p) => p.studentId === s.id) ?? null),
  );
  // The same list the IA reviews page shows; there is no "resolved" state yet.
  const escalatedOpen = escalated;
  const attentionCount =
    unmatched.length + pastDue.length + lowOnHours.length + escalatedOpen.length;

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
          title="Needs you"
          description={
            attentionCount === 0 && withoutPlan.length === 0
              ? "Nothing waiting. Payments are matched, nobody is short of hours, and every student has a plan."
              : "The things only the owner can resolve. Each one links to where it is done."
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Payments</p>
              <Badge tone={unmatched.length + pastDue.length > 0 ? "warning" : "success"}>
                {unmatched.length + pastDue.length > 0 ? "Action needed" : "All matched"}
              </Badge>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-700">
              <li>
                {unmatched.length === 0
                  ? "Every paid order is attached to a student."
                  : `${unmatched.length} paid ${unmatched.length === 1 ? "order has" : "orders have"} no student yet — nothing has been granted.`}
              </li>
              {pastDue.length > 0 ? (
                <li>{`${pastDue.length} instalment ${pastDue.length === 1 ? "plan is" : "plans are"} past due.`}</li>
              ) : null}
              {pendingWise.length > 0 ? (
                <li>{`${pendingWise.length} bank ${pendingWise.length === 1 ? "transfer is" : "transfers are"} awaited.`}</li>
              ) : null}
            </ul>
            <Link href="/admin/orders" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
              Orders
            </Link>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Hours running low</p>
              <Badge tone={lowOnHours.length > 0 ? "warning" : "success"}>
                {lowOnHours.length > 0 ? String(lowOnHours.length) : "None"}
              </Badge>
            </div>
            {lowOnHours.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">
                Nobody who bought hours has two or fewer left to book.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {lowOnHours.slice(0, 6).map((b) => (
                  <li key={b.studentId} className="flex flex-wrap justify-between gap-2">
                    <Link href={`/admin/students/${b.studentId}`} className="text-ink-700 hover:text-accent hover:underline">
                      {nameOf(b.studentId)}
                    </Link>
                    <span className={b.remainingMinutes < 0 ? "text-danger" : "text-warning"}>
                      {b.remainingMinutes < 0
                        ? `${hoursLabel(-b.remainingMinutes)} over`
                        : `${hoursLabel(b.remainingMinutes)} left`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">IA reviews asked for a person</p>
              <Badge tone={escalatedOpen.length > 0 ? "warning" : "success"}>
                {escalatedOpen.length > 0 ? String(escalatedOpen.length) : "None"}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-ink-500">
              {escalatedOpen.length === 0
                ? "No student is waiting on a professional read."
                : "Students who asked for a tutor to read their IA after the automatic review."}
            </p>
            <Link href="/admin/ia-reviews" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
              IA reviews
            </Link>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Study plans</p>
              <Badge tone={withoutPlan.length > 0 ? "info" : "success"}>
                {withoutPlan.length > 0 ? `${withoutPlan.length} to write` : "Up to date"}
              </Badge>
            </div>
            {withoutPlan.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">Every active student has a current plan.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {withoutPlan.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex flex-wrap justify-between gap-2">
                    <Link href={`/admin/students/${s.id}`} className="text-ink-700 hover:text-accent hover:underline">
                      {s.profile.fullName}
                    </Link>
                    <span className="text-ink-300">
                      {plans.some((p) => p.studentId === s.id) ? "Review due" : "No plan"}
                    </span>
                  </li>
                ))}
                {withoutPlan.length > 6 ? (
                  <li className="text-ink-300">and {withoutPlan.length - 6} more</li>
                ) : null}
              </ul>
            )}
          </Card>
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
              <p className="font-semibold text-ink">Payments — Stripe ({currenciesFor("stripe")})</p>
              <Badge tone={stripePayments.configured ? "success" : "neutral"}>
                {stripePayments.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">{stripePayments.detail}</p>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Payments — Wise ({currenciesFor("wise")})</p>
              <Badge tone={wisePayments.configured ? "success" : "neutral"}>
                {wisePayments.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">{wisePayments.detail}</p>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Payments — Bitcoin (BTCPay)</p>
              <Badge tone={btcPayConfig() ? "success" : "neutral"}>
                {btcPayConfig() ? "Connected" : "Off"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-ink-500">
              {btcPayConfig()
                ? "Ready — mainnet. Bitcoin is offered at checkout for one-time purchases."
                : "Not offered. Needs BTCPAY_LIVE_ENABLED, a mainnet store, an API key and a webhook secret."}
            </p>
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
