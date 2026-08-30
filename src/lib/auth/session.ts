import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapProfile } from "@/lib/data/mappers";
import { demoState } from "@/lib/data/demo-store";
import type { PortalSession, UserRole } from "@/lib/types";

export const DEMO_COOKIE = "oys_demo_profile";

/** Where each role lands after signing in, and where a mis-routed request is
 *  sent back to. One table, so the rule cannot disagree with itself. */
export const HOME_FOR_ROLE: Record<UserRole, string> = {
  student: "/student",
  tutor: "/tutor",
  admin: "/admin",
  parent: "/parent",
};

async function demoSession(): Promise<PortalSession | null> {
  const store = await cookies();
  const profileId = store.get(DEMO_COOKIE)?.value;
  if (!profileId) return null;

  const profile = demoState.profiles.find((p) => p.id === profileId);
  if (!profile) return null;

  return {
    profile,
    studentId: demoState.students.find((s) => s.profileId === profile.id)?.id ?? null,
    tutorId: demoState.tutors.find((t) => t.profileId === profile.id)?.id ?? null,
    parentId: demoState.parents.find((p) => p.profileId === profile.id)?.id ?? null,
    isDemo: true,
  };
}

async function supabaseSession(): Promise<PortalSession | null> {
  const db = await createSupabaseServerClient();

  // getUser(), not getSession(): the former revalidates the JWT with the auth
  // server, so a revoked or forged cookie cannot produce a signed-in session.
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data: profileRow } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profileRow) return null;
  const profile = mapProfile(profileRow);
  if (!profile.active) return null;

  const [student, tutor, parent] = await Promise.all([
    profile.role === "student"
      ? db.from("students").select("id").eq("profile_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    /* Admins are looked up too, because the owner of a small practice teaches.
       A tutor record is what makes someone assignable to a lesson, so an admin
       who has one gets a tutorId and can use the teaching pages for their own
       students; an admin who does not simply gets null and never sees them. */
    profile.role === "tutor" || profile.role === "admin"
      ? db.from("tutors").select("id").eq("profile_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile.role === "parent"
      ? db.from("parents").select("id").eq("profile_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    profile,
    studentId: (student.data as { id?: string } | null)?.id ?? null,
    tutorId: (tutor.data as { id?: string } | null)?.id ?? null,
    parentId: (parent.data as { id?: string } | null)?.id ?? null,
    isDemo: false,
  };
}

export async function getPortalSession(): Promise<PortalSession | null> {
  return isDemoMode() ? demoSession() : supabaseSession();
}

/** For pages that must have a user. Redirects rather than throwing, so an
 *  expired session looks like a sign-in prompt and not an error. */
export async function requireSession(): Promise<PortalSession> {
  const session = await getPortalSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * For pages that belong to one role. A student who guesses `/admin` is sent to
 * their own dashboard — but note that this is a routing convenience, not the
 * security boundary: the data itself is protected by RLS, so even if this were
 * removed the admin queries would return nothing.
 */
export async function requireRole(...roles: UserRole[]): Promise<PortalSession> {
  const session = await requireSession();
  if (!roles.includes(session.profile.role)) {
    redirect(HOME_FOR_ROLE[session.profile.role]);
  }
  return session;
}

/**
 * The gate for the teaching pages.
 *
 * Tutors, plus any admin who actually has a tutor record — the owner of a
 * practice this size teaches as well as runs it, and asking them to hold two
 * logins to do both would be silly.
 *
 * The tutor record is the test rather than the role, because it is what makes
 * a person assignable to a lesson. An admin without one has no students of
 * their own and nothing to show, so they are sent back to the overview.
 */
export async function requireTeachingAccess(): Promise<
  PortalSession & { tutorId: string }
> {
  const session = await requireSession();
  const allowed = session.profile.role === "tutor" || session.profile.role === "admin";

  if (!allowed || !session.tutorId) {
    redirect(HOME_FOR_ROLE[session.profile.role]);
  }
  return session as PortalSession & { tutorId: string };
}

/** Does this person teach, whatever else they also do? Used by the navigation
 *  to decide whether the teaching pages are worth offering. */
export function teaches(session: PortalSession): boolean {
  return (
    session.tutorId !== null &&
    (session.profile.role === "tutor" || session.profile.role === "admin")
  );
}
