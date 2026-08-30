import Link from "next/link";

import { Brand } from "@/components/portal/brand";
import { MobileNav } from "@/components/portal/mobile-nav";
import { NavLinks } from "@/components/portal/nav-links";
import { NotificationBell } from "@/components/portal/notification-bell";
import { LogOutIcon, UserIcon } from "@/components/ui/icons";
import { Avatar, cx } from "@/components/ui/primitives";
import { signOut } from "@/lib/actions/auth";
import { navFor, ROLE_LABEL } from "@/lib/navigation";
import type { Notification, PortalSession } from "@/lib/types";

/* ==========================================================================
   App shell
   --------------------------------------------------------------------------
   A fixed sidebar on large screens, a drawer below that, and one slim bar over
   the content column carrying the things that are not navigation. The content
   column is capped at a readable width rather than filling a 27" display,
   which is most of what separates this from an admin template.
   ========================================================================== */

function AccountBlock({ session }: { session: PortalSession }) {
  return (
    <div className="space-y-1">
      <Link
        href="/profile"
        className="flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <UserIcon className="shrink-0 text-ink-300" />
        Profile
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <LogOutIcon className="shrink-0 text-ink-300" />
          Log out
        </button>
      </form>
    </div>
  );
}

export function AppShell({
  session,
  notifications,
  children,
}: {
  session: PortalSession;
  notifications: Notification[];
  children: React.ReactNode;
}) {
  const items = navFor(session);

  return (
    <div className="min-h-screen bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[6px] focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>

      {/* -- Sidebar, large screens -- */}
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] flex-col border-r border-rule bg-paper-3 lg:flex">
        <div className="px-5 py-5">
          <Brand href={`/${session.profile.role}`} />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
          <NavLinks items={items} />
        </nav>
        <div className="border-t border-rule px-3 py-4">
          <div className="mb-3 flex items-center gap-3 px-3">
            <Avatar name={session.profile.fullName} size={34} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{session.profile.fullName}</p>
              <p className="truncate text-xs text-ink-300">{ROLE_LABEL[session.profile.role]}</p>
            </div>
          </div>
          <AccountBlock session={session} />
        </div>
      </aside>

      <div className="lg:pl-[264px]">
        {/* -- Bar over the content column -- */}
        <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <MobileNav
              items={items}
              footer={
                <>
                  <div className="mb-3 flex items-center gap-3 px-3">
                    <Avatar name={session.profile.fullName} size={34} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {session.profile.fullName}
                      </p>
                      <p className="truncate text-xs text-ink-300">
                        {ROLE_LABEL[session.profile.role]}
                      </p>
                    </div>
                  </div>
                  <AccountBlock session={session} />
                </>
              }
            />
            <div className="lg:hidden">
              <Brand href={`/${session.profile.role}`} />
            </div>

            <div className="ml-auto flex items-center gap-2">
              {session.isDemo ? <DemoChip /> : null}
              <NotificationBell notifications={notifications} />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Demo mode has to be impossible to mistake for the real thing. */
function DemoChip({ className }: { className?: string }) {
  return (
    <Link
      href="/demo/switch"
      prefetch={false}
      className={cx(
        "hidden items-center gap-1.5 rounded-full border border-warning/30 bg-warning-wash px-2.5 py-1 text-xs font-semibold text-warning transition-colors hover:border-warning/60 sm:inline-flex",
        className,
      )}
      title="You are looking at invented sample data. Click to switch account."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
      Demo data
    </Link>
  );
}
