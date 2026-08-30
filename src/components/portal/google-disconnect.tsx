"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import { disconnectGoogle } from "@/lib/actions/google";

/** Disconnecting revokes the grant at Google as well as dropping the token
 *  here, so it is worth a confirmation — reconnecting means going through
 *  consent again. */
export function DisconnectGoogleButton() {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        Disconnect
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-500">
        Lessons already booked keep their links. Disconnect?
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await disconnectGoogle();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setConfirming(false);
            router.refresh();
          })
        }
      >
        {pending ? "Disconnecting…" : "Yes, disconnect"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      {error ? <span className="text-sm text-warning">{error}</span> : null}
    </span>
  );
}
