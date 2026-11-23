import Link from "next/link";

import { hoursLabel } from "@/components/portal/student-records";
import { Avatar, Badge } from "@/components/ui/primitives";
import { formatDayAndTime, relativeDayLabel } from "@/lib/format";
import {
  isLowOnHours,
  planNeedsAttention,
  type Student,
  type StudentHourBalance,
  type StudyPlan,
} from "@/lib/types";

export function TutorStudentCard({
  student,
  subjects,
  lastLessonAt,
  nextLessonAt,
  openHomework,
  hours,
  plan,
}: {
  student: Student;
  subjects: string[];
  lastLessonAt?: string | null;
  nextLessonAt?: string | null;
  openHomework?: number;
  /** Omitted to hide the hours line; null when the balance could not be read. */
  hours?: StudentHourBalance | null;
  /** Omitted to hide the plan badge; null when no plan has been written. */
  plan?: StudyPlan | null;
}) {
  const showHours = hours !== undefined && hours !== null && hours.purchasedMinutes > 0;
  const low = isLowOnHours(hours);
  const planDue = plan !== undefined && planNeedsAttention(plan);

  return (
    <li>
      <Link
        href={`/tutor/students/${student.id}`}
        className="card card-interactive flex h-full flex-col p-5"
      >
        <div className="flex items-center gap-3">
          <Avatar name={student.profile.fullName} size={40} />
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg font-semibold text-ink">
              {student.profile.fullName}
            </h3>
            {student.yearLevel || student.school ? (
              <p className="truncate text-xs text-ink-300">
                {[student.yearLevel, student.school].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
        </div>

        {subjects.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {subjects.map((name) => (
              <li
                key={name}
                className="rounded-full border border-rule bg-paper-2 px-2.5 py-0.5 text-xs text-ink-500"
              >
                {name}
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="mt-4 space-y-1 text-sm">
          {lastLessonAt !== undefined ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-300">Last</dt>
              <dd className="truncate text-ink-700">
                {lastLessonAt ? relativeDayLabel(lastLessonAt) : "No lessons yet"}
              </dd>
            </div>
          ) : null}
          {nextLessonAt !== undefined ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-300">Next</dt>
              <dd className="truncate text-ink-700">
                {nextLessonAt ? formatDayAndTime(nextLessonAt) : "Not booked"}
              </dd>
            </div>
          ) : null}
        </dl>

        {openHomework ? (
          <p className="mt-3 text-xs font-semibold text-warning">
            {openHomework} {openHomework === 1 ? "task" : "tasks"} outstanding
          </p>
        ) : null}

        {showHours || planDue ? (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
            {showHours ? (
              <Badge tone={low ? "warning" : "neutral"}>
                {hours!.remainingMinutes < 0
                  ? `${hoursLabel(-hours!.remainingMinutes)} over`
                  : `${hoursLabel(hours!.remainingMinutes)} left`}
              </Badge>
            ) : null}
            {planDue ? <Badge tone="info">{plan ? "Plan review due" : "No study plan"}</Badge> : null}
          </div>
        ) : null}
      </Link>
    </li>
  );
}
