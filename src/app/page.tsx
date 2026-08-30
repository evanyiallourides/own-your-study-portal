import { redirect } from "next/navigation";

import { getPortalSession, HOME_FOR_ROLE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** The portal has no landing page of its own — the marketing site is that.
 *  This resolves the signed-in role and sends the visitor to their dashboard. */
export default async function RootPage() {
  const session = await getPortalSession();
  redirect(session ? HOME_FOR_ROLE[session.profile.role] : "/login");
}
