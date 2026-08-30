"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { Brand } from "@/components/portal/brand";
import { NavLinks } from "@/components/portal/nav-links";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import type { NavItem } from "@/lib/navigation";

/**
 * A drawer rather than a bottom bar: the portal has six or eight destinations
 * per role, which is two too many for a tab bar to hold without abbreviating
 * the labels into guesswork.
 */
export function MobileNav({ items, footer }: { items: NavItem[]; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating is the one thing that should always close the drawer. Adjusting
  // during render rather than in an effect means the closed drawer is what
  // paints — an effect would show the new page with the drawer still over it
  // for a frame.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="mobile-drawer"
        className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-[8px] text-ink-500 hover:bg-paper-2 hover:text-ink lg:hidden"
      >
        <MenuIcon />
        <span className="sr-only">Open menu</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
          />
          <div
            id="mobile-drawer"
            className="absolute inset-y-0 left-0 flex w-[min(19rem,85vw)] flex-col border-r border-rule bg-paper-3 shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3.5">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-paper-2 hover:text-ink"
              >
                <CloseIcon />
                <span className="sr-only">Close menu</span>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
              <NavLinks items={items} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="border-t border-rule px-3 py-4">{footer}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
