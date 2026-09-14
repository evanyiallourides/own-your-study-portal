import type { Metadata } from "next";
import Link from "next/link";

import { LinkOrderForm, UnlinkOrderButton } from "@/components/portal/order-forms";
import { Badge, Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { StatusTone } from "@/lib/status";
import {
  isInstalmentPlanRunning,
  isUnmatched,
  type Order,
  type OrderStatus,
} from "@/lib/types";

/* ==========================================================================
   /admin/orders
   --------------------------------------------------------------------------
   Ordered by what needs a person, not by what happened most recently.

   Almost everything on this page is a record. One part is a queue: a payment
   that arrived with nobody attached to it. That happens by design — the
   marketing site is static and the portal has no self-signup, so a stranger can
   buy before anyone knows who they are — and if nothing surfaces it, the money
   sits there and the buyer waits for access that never comes.

   Totals are never added across currencies. A number that blends euros into
   dollars is worse than no number, because it looks like one.
   ========================================================================== */

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  pending: "neutral",
  // Authorised is not paid: a direct debit sits here for days and can still
  // fail, so it reads as something in flight rather than something settled.
  authorised: "info",
  paid: "success",
  instalments_active: "accent",
  past_due: "danger",
  completed: "success",
  refunded: "warning",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Started",
  authorised: "Authorised",
  paid: "Paid",
  instalments_active: "Plan running",
  past_due: "Payment failed",
  completed: "Completed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function OrderLine({ order }: { order: Order }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="font-semibold text-ink">{order.skuName}</p>
        <p className="truncate text-sm text-ink-500">
          {order.buyerName ? `${order.buyerName} · ` : ""}
          {order.buyerEmail}
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold tabular-nums text-ink">
          {money(order.amountTotalMinor, order.currency)}
        </p>
        <p className="text-xs text-ink-500">{formatDate(order.createdAt)}</p>
      </div>
    </div>
  );
}

export default async function AdminOrders() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [orders, students] = await Promise.all([repo.listOrders(), repo.listStudents()]);

  const unmatched = orders.filter(isUnmatched);
  const failing = orders.filter((o) => o.status === "past_due");
  const running = orders.filter(isInstalmentPlanRunning);
  const settled = orders.filter(
    (o) => !isUnmatched(o) && o.status !== "past_due" && o.status !== "pending",
  );

  /* Per currency, never blended. */
  const collected = new Map<string, number>();
  for (const o of orders) {
    if (o.amountPaidMinor <= 0) continue;
    collected.set(o.currency, (collected.get(o.currency) ?? 0) + o.amountPaidMinor);
  }

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Orders"
        description="Everything bought, and anything that needs a person."
      />

      {collected.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...collected.entries()].map(([currency, minor]) => (
            <Card key={currency} className="px-5 py-4">
              <p className="text-xs uppercase tracking-[0.14em] text-ink-500">
                Collected · {currency.toUpperCase()}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
                {money(minor, currency)}
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* -- the queue ---------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHead
          title="Needs attention"
          description="Payments with nobody attached, and plans that have stopped collecting."
        />

        {unmatched.length === 0 && failing.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Every payment is attached to a student and every plan is collecting."
          />
        ) : (
          <div className="space-y-4">
            {unmatched.map((order) => (
              <Card key={order.id} className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <OrderLine order={order} />
                  <Badge tone="warning">Nobody attached</Badge>
                </div>
                <p className="text-sm text-ink-500">
                  Paid from{" "}
                  <span className="text-ink">{order.sourceSite ?? "the site"}</span>. Nobody with
                  this email has a portal account yet
                  {order.grantsQuestionBankDays !== null
                    ? ", so the access they paid for is not switched on."
                    : "."}
                </p>
                <LinkOrderForm
                  orderId={order.id}
                  buyerEmail={order.buyerEmail}
                  students={students.map((s) => ({
                    id: s.id,
                    name: s.profile?.fullName ?? s.id,
                    email: s.profile?.email ?? "",
                  }))}
                />
              </Card>
            ))}

            {failing.map((order) => (
              <Card key={order.id} className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-4">
                  <OrderLine order={order} />
                  <Badge tone="danger">Payment failed</Badge>
                </div>
                <p className="text-sm text-ink-500">
                  Instalment {order.instalmentsPaid + 1} of {order.instalmentMonths} did not go
                  through. Stripe is retrying — access stays on until the plan is finally
                  abandoned, so there is nothing to do here unless it keeps failing.
                </p>
                {order.studentId && (
                  <Link
                    href={`/admin/students/${order.studentId}`}
                    className="text-sm underline underline-offset-4"
                  >
                    {order.studentName}
                  </Link>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* -- plans in progress -------------------------------------------- */}
      {running.length > 0 && (
        <section className="space-y-4">
          <SectionHead title="Payment plans running" />
          <div className="space-y-3">
            {running.map((order) => (
              <Card key={order.id} className="space-y-3 p-5">
                <OrderLine order={order} />
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${Math.round(
                          (order.instalmentsPaid / (order.instalmentMonths ?? 1)) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm tabular-nums text-ink-500">
                    {order.instalmentsPaid} of {order.instalmentMonths} paid
                  </span>
                </div>
                <p className="text-sm text-ink-500">
                  {money(order.amountPaidMinor, order.currency)} of{" "}
                  {money(order.amountTotalMinor, order.currency)} collected
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* -- the record ---------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHead title="All orders" description="Abandoned checkouts are not shown." />
        {settled.length === 0 ? (
          <EmptyState title="No orders yet" description="Nothing has been bought." />
        ) : (
          <Card className="divide-y divide-rule p-0">
            {settled.map((order) => (
              <div key={order.id} className="space-y-2 p-5">
                <div className="flex items-start justify-between gap-4">
                  <OrderLine order={order} />
                  <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                  {order.studentId ? (
                    <Link
                      href={`/admin/students/${order.studentId}`}
                      className="underline underline-offset-4"
                    >
                      {order.studentName}
                    </Link>
                  ) : (
                    <span>Not attached to a student</span>
                  )}
                  {order.taxAmountMinor > 0 && (
                    <span>incl. {money(order.taxAmountMinor, order.currency)} tax</span>
                  )}
                  {order.note && <span className="italic">{order.note}</span>}
                  {order.studentId && <UnlinkOrderButton orderId={order.id} />}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
