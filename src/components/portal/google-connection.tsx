import { ButtonLink, Badge, Card } from "@/components/ui/primitives";
import { CalendarIcon } from "@/components/ui/icons";
import { DisconnectGoogleButton } from "@/components/portal/google-disconnect";
import type { GoogleState } from "@/lib/google/status";

/* ==========================================================================
   Google Calendar connection
   --------------------------------------------------------------------------
   A tutor connects their own account, not the organisation's. That is the
   right shape for a tutoring practice: the lesson lands in the calendar of the
   person teaching it, the invitation comes from them, and the Meet link is
   hosted by them — so they are the host when they arrive, and a student who
   joins early waits rather than sitting in a meeting nobody is running.
   ========================================================================== */

export function GoogleConnectionCard({
  state,
  notice,
  returnTo = "/profile",
}: {
  state: GoogleState;
  /** Message carried back on the ?google= parameter after a connect attempt. */
  notice?: string;
  returnTo?: string;
}) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Google Calendar</h2>
          <p className="mt-1 text-ink-500">
            Connect your calendar and the portal can create the Meet link for each lesson and
            invite your student to it.
          </p>
        </div>
        {state.connected ? <Badge tone="success">Connected</Badge> : null}
      </div>

      {notice ? (
        <p
          role="status"
          className="mb-4 rounded-[10px] border border-rule bg-paper-2 px-4 py-3 text-sm text-ink-700"
        >
          {notice}
        </p>
      ) : null}

      <Card>
        {!state.available ? (
          <p className="text-sm text-ink-500">{state.blocker}</p>
        ) : state.connected ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-2 text-ink-700">
                <CalendarIcon />
                {state.email}
              </span>
            </div>

            {state.error ? (
              <p className="rounded-[8px] border border-warning/25 bg-warning-wash px-3 py-2 text-sm text-warning">
                {state.error}
              </p>
            ) : null}

            <p className="text-sm text-ink-500">
              The portal can create and update events it made. It cannot read the rest of your
              calendar — the connection is scoped to events, not to your diary.
            </p>

            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/api/google/connect?returnTo=${encodeURIComponent(returnTo)}`} variant="outline">
                Reconnect
              </ButtonLink>
              <DisconnectGoogleButton />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-ink-500">
              You will be asked to allow the portal to manage calendar events. It asks for the
              narrowest permission that does the job: it can create and change the lessons it
              makes, and cannot read anything else in your calendar.
            </p>
            <ButtonLink
              href={`/api/google/connect?returnTo=${encodeURIComponent(returnTo)}`}
              variant="solid"
            >
              <CalendarIcon />
              Connect Google Calendar
            </ButtonLink>
          </div>
        )}
      </Card>
    </section>
  );
}
