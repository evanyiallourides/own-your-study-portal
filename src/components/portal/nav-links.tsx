"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  BookIcon,
  CalendarIcon,
  ChartIcon,
  ChecklistIcon,
  FolderIcon,
  HomeIcon,
  PeopleIcon,
  SettingsIcon,
  SparkIcon,
  UserIcon,
} from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import type { NavItem } from "@/lib/navigation";

const ICONS = {
  home: HomeIcon,
  book: BookIcon,
  calendar: CalendarIcon,
  checklist: ChecklistIcon,
  chart: ChartIcon,
  folder: FolderIcon,
  people: PeopleIcon,
  user: UserIcon,
  settings: SettingsIcon,
  spark: SparkIcon,
} as const;

export function NavLinks({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ul className="space-y-0.5">
      {items.map((item, index) => {
        const Icon = ICONS[item.icon];
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        /* A group heading is drawn once, on the first item that carries it.
           The owner's sidebar is the only one with groups today: running the
           practice and teaching in it are different jobs, and a flat list of
           eleven links presents them as one. */
        const startsGroup = item.group && item.group !== items[index - 1]?.group;

        return (
          <li key={item.href}>
            {startsGroup ? (
              <p className="mt-5 mb-1.5 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink-300">
                {item.group}
              </p>
            ) : null}
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cx(
                "group flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-accent-wash text-accent"
                  : "text-ink-500 hover:bg-paper-2 hover:text-ink",
              )}
            >
              <Icon className={cx("shrink-0", active ? "text-accent" : "text-ink-300 group-hover:text-ink-500")} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
