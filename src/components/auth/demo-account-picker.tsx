"use client";

import { useState, useTransition } from "react";

import { ArrowRightIcon } from "@/components/ui/icons";
import { Avatar, cx } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { signInAsDemoUser } from "@/lib/actions/auth";
import { ROLE_LABEL } from "@/lib/navigation";
import type { Profile } from "@/lib/types";

/** What each demo account is for. Without this the picker is four names and a
 *  guess about which one shows the review workflow. */
const BLURB: Record<string, string> = {
  student: "Two subjects, twelve published lessons, a transcript and outstanding homework.",
  tutor: "Two assigned students and two lesson write-ups waiting to be reviewed and published.",
  admin: "Everything: people, subjects, assignments, the lesson pipeline and the notetaker.",
  parent: "Read-only sight of one child's lessons and progress.",
};

export function DemoAccountPicker({ profiles }: { profiles: Profile[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One representative account per role keeps the list to four rows; the second
  // student exists in the data so cross-student access can be tested, but it is
  // not a useful thing to sign in as.
  const shown = profiles.filter((p) =>
    ["p-sophia", "p-imogen", "p-admin", "p-helen"].includes(p.id),
  );

  return (
    <div className="space-y-3">
      {error ? <ErrorState title="Could not switch account" description={error} /> : null}
      <ul className="space-y-2.5">
        {shown.map((profile) => (
          <li key={profile.id}>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setBusyId(profile.id);
                setError(null);
                startTransition(async () => {
                  try {
                    await signInAsDemoUser(profile.id);
                  } catch (err) {
                    // A redirect throws by design; anything else is real.
                    if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
                      setError(err.message);
                    }
                  } finally {
                    setBusyId(null);
                  }
                });
              }}
              className={cx(
                "card card-interactive flex w-full items-center gap-4 p-4 text-left",
                pending && busyId === profile.id && "opacity-60",
              )}
            >
              <Avatar name={profile.fullName} size={40} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">
                  {profile.fullName}{" "}
                  <span className="font-normal text-ink-300">
                    · {ROLE_LABEL[profile.role]}
                  </span>
                </p>
                <p className="mt-0.5 text-sm leading-snug text-ink-500">{BLURB[profile.role]}</p>
              </div>
              <ArrowRightIcon className="shrink-0 text-ink-300" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
