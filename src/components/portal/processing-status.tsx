import { AlertIcon, SparkIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/primitives";
import { LESSON_STATUS } from "@/lib/status";
import type { LessonStatus } from "@/lib/types";

/* ==========================================================================
   AI processing status
   --------------------------------------------------------------------------
   The same status enum told two different ways. A student is not shown "review
   required" — that a tutor has a draft open is not their business, and telling
   them creates an expectation the tutor has not agreed to.
   ========================================================================== */

export function AIProcessingStatus({
  status,
  audience,
  error,
  className,
}: {
  status: LessonStatus;
  audience: "student" | "staff";
  error?: string | null;
  className?: string;
}) {
  const presentation = LESSON_STATUS[status];
  const detail = audience === "student" ? presentation.studentDetail : presentation.staffDetail;
  const isProblem = status === "failed";

  return (
    <div
      className={className}
      role={isProblem ? "alert" : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={presentation.tone}>
          {isProblem ? <AlertIcon className="h-3.5 w-3.5" /> : <SparkIcon className="h-3.5 w-3.5" />}
          {presentation.label}
        </Badge>
        <p className="text-sm text-ink-500">{detail}</p>
      </div>
      {isProblem && error && audience === "staff" ? (
        <p className="mt-2 text-sm text-danger">{error}</p>
      ) : null}
    </div>
  );
}
