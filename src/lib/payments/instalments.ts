import "server-only";

import type Stripe from "stripe";

/* ==========================================================================
   Capping an instalment plan
   --------------------------------------------------------------------------
   Checkout can only create an open-ended subscription. Left alone, "4 monthly
   payments of $330" bills $330 every month forever — which is the single worst
   thing this integration could do, so it is done immediately after the session
   completes and it shouts if it fails.

   The mechanism is a subscription schedule whose one phase lasts exactly the
   number of months owed, with `end_behavior: "cancel"`.

   Note for anyone comparing this against Stripe's docs: the installment-plan
   example there uses `phases[0].iterations`, which does not exist in this SDK
   version. `duration: { interval: "month", interval_count: n }` replaced it.
   Copying the doc sample verbatim fails.
   ========================================================================== */

export interface CapResult {
  scheduleId: string | null;
  /** Set when the plan could NOT be capped. Treat as an incident, not a warning. */
  problem: string | null;
}

export async function capInstalmentPlan(
  stripe: Stripe,
  subscriptionId: string,
  months: number,
): Promise<CapResult> {
  try {
    // Creating from the subscription gives a schedule with one phase that
    // mirrors what Checkout just set up — the right items, the right price,
    // the right start.
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    });

    const phase = schedule.phases[0];
    if (!phase) {
      return { scheduleId: schedule.id, problem: "Stripe returned a schedule with no phases." };
    }

    // An update replaces the phases wholesale, so everything worth keeping has
    // to be restated — items and the start it already has.
    const capped = await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "cancel",
      phases: [
        {
          items: phase.items.map((item) => ({
            price: typeof item.price === "string" ? item.price : item.price.id,
            quantity: item.quantity ?? 1,
          })),
          start_date: phase.start_date,
          duration: { interval: "month", interval_count: months },
        },
      ],
    });

    return { scheduleId: capped.id, problem: null };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Unknown error.";
    return { scheduleId: null, problem: detail };
  }
}
