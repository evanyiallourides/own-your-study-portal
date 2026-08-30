"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";

/**
 * The catch-all inside the portal shell. It never prints the underlying error:
 * a database message can name tables and columns, and the person reading it
 * cannot act on that anyway. The digest is shown so a support conversation can
 * point at a specific server log line.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal]", error.message, error.digest);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <ErrorState
        title="This page could not be loaded"
        description="Something went wrong at our end. Trying again usually works; if it does not, tell us and we will look at it."
        action={
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="solid" onClick={reset}>
              Try again
            </Button>
            <ButtonLink href="/">Back to your dashboard</ButtonLink>
          </div>
        }
      />
      {error.digest ? (
        <p className="mt-4 text-xs text-ink-300">Reference: {error.digest}</p>
      ) : null}
    </div>
  );
}
