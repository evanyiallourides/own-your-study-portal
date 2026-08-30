import type { PortalSession, UserRole } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  /** Key into the icon map in the sidebar component. Kept as a string so this
   *  file stays free of JSX and can be imported anywhere. */
  icon:
    | "home"
    | "book"
    | "calendar"
    | "checklist"
    | "chart"
    | "folder"
    | "people"
    | "user"
    | "settings"
    | "spark";
  /** Match the pathname exactly rather than by prefix. Used for the section
   *  root, so `/student/lessons` does not light up "Home". */
  exact?: boolean;
  /** Starts a labelled group in the sidebar. Only the owner's navigation has
   *  one today — running the practice and teaching in it are different jobs
   *  and the sidebar should not present them as one flat list. */
  group?: string;
}

const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  student: [
    { href: "/student", label: "Home", icon: "home", exact: true },
    { href: "/student/subjects", label: "My Subjects", icon: "book" },
    { href: "/student/lessons", label: "Lessons", icon: "calendar" },
    { href: "/student/homework", label: "Homework", icon: "checklist" },
    { href: "/student/progress", label: "Progress", icon: "chart" },
    { href: "/student/resources", label: "Resources", icon: "folder" },
  ],
  tutor: [
    { href: "/tutor", label: "Home", icon: "home", exact: true },
    { href: "/tutor/students", label: "My Students", icon: "people" },
    { href: "/tutor/lessons", label: "Lessons", icon: "calendar" },
    { href: "/tutor/schedule", label: "Schedule", icon: "checklist" },
    { href: "/tutor/resources", label: "Resources", icon: "folder" },
  ],
  admin: [
    { href: "/admin", label: "Overview", icon: "home", exact: true },
    { href: "/admin/students", label: "Students", icon: "people" },
    { href: "/admin/tutors", label: "Tutors", icon: "user" },
    { href: "/admin/subjects", label: "Subjects", icon: "book" },
    { href: "/admin/lessons", label: "Lessons", icon: "calendar" },
    { href: "/admin/assignments", label: "Assignments", icon: "checklist" },
    { href: "/admin/notetaker", label: "AI Notetaker", icon: "spark" },
    { href: "/admin/settings", label: "Settings", icon: "settings" },
  ],
  parent: [
    { href: "/parent", label: "Home", icon: "home", exact: true },
    { href: "/parent/lessons", label: "Lessons", icon: "calendar" },
    { href: "/parent/progress", label: "Progress", icon: "chart" },
  ],
};

/**
 * The navigation for a person, rather than for a role.
 *
 * Almost everybody is one role and gets that role's list. The exception is the
 * owner of a small practice, who runs it and also teaches: they hold the admin
 * role, and a tutor record on top of it. Rather than a second login or a role
 * switcher, their teaching pages are appended to the administrator's list —
 * one account, one sidebar, the two jobs separated by a rule.
 */
export function navFor(session: PortalSession): NavItem[] {
  const base = NAV_BY_ROLE[session.profile.role];

  if (session.profile.role !== "admin" || !session.tutorId) return base;

  return [
    ...base,
    { href: "/tutor", label: "My teaching", icon: "calendar", exact: true, group: "Teaching" },
    { href: "/tutor/students", label: "My students", icon: "people", group: "Teaching" },
    { href: "/tutor/schedule", label: "My schedule", icon: "checklist", group: "Teaching" },
  ];
}

export const ROLE_LABEL: Record<UserRole, string> = {
  student: "Student",
  tutor: "Tutor",
  admin: "Administrator",
  parent: "Parent",
};
