import { AppShell } from "@/components/portal/app-shell";
import { requireSession } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

/** Everything behind the sign-in lives under this layout, which resolves the
 *  session once per request and hands it to the shell. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const repo = await repositoryFor(session);

  // Notifications are cheap and appear on every screen, so they are fetched
  // here rather than in each page.
  const notifications = await repo.listNotifications(10).catch(() => []);

  return (
    <AppShell session={session} notifications={notifications}>
      {children}
    </AppShell>
  );
}
