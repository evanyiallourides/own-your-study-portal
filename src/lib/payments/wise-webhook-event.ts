/* ==========================================================================
   Reading a Wise webhook envelope
   --------------------------------------------------------------------------
   Kept apart from the route, and free of any Next.js import, for the same
   reason events.ts is: the decision worth testing is what this extracts, not
   how an HTTP handler holding a database connection behaves.

   UNVERIFIED AGAINST A REAL DELIVERY: written against Wise's
   generally-documented webhook shape — a thin `incoming-transfer#credited`
   event carrying a resource id — but the exact field names were not
   confirmed against Wise's current API reference while this was written.
   Confirm against a real test delivery (Wise's dashboard can send one)
   before relying on this in production, and correct this file alone if it
   disagrees — nothing downstream of it needs to change either way.
   ========================================================================== */

export interface IncomingTransferEvent {
  eventId: string;
  eventType: string;
  transferId: string | null;
}

/** Reads only what every Wise webhook envelope is documented to carry. */
export function parseIncomingTransferEvent(body: unknown): IncomingTransferEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const envelope = body as Record<string, unknown>;

  const eventType = typeof envelope.event_type === "string" ? envelope.event_type : null;
  if (!eventType) return null;

  const data = envelope.data as Record<string, unknown> | undefined;
  const resource = data?.resource as Record<string, unknown> | undefined;
  const transferId =
    typeof resource?.id === "string"
      ? resource.id
      : typeof data?.resource_id === "string"
        ? (data.resource_id as string)
        : null;

  // Falls back to the transfer id when Wise sends no separate delivery id —
  // still enough to deduplicate a redelivery of the same event.
  const eventId =
    typeof envelope.subscription_id === "string" && transferId
      ? `${envelope.subscription_id}:${transferId}`
      : (transferId ?? JSON.stringify(envelope).slice(0, 100));

  return { eventId, eventType, transferId };
}
