"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionResult } from "@/lib/actions/result";
import { requireRole } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { env, isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { USER_ROLES } from "@/lib/types";

/* ==========================================================================
   Administration actions
   --------------------------------------------------------------------------
   Each one re-checks the role on the server. `requireRole` in a page is a
   routing convenience; an action is an endpoint and has to check for itself.
   ========================================================================== */

const subjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  curriculum: z.string().trim().min(1).max(60),
  level: z.string().trim().max(60).optional(),
  division: z.string().trim().max(60).optional(),
});

export async function createSubject(
  input: z.input<typeof subjectSchema>,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "A subject needs a name and a curriculum." };

  try {
    const repo = await getRepository();
    await repo.createSubject({
      name: parsed.data.name,
      curriculum: parsed.data.curriculum,
      level: parsed.data.level || null,
      division: parsed.data.division || null,
    });
    revalidatePath("/admin/subjects");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setSubjectArchived(input: {
  subjectId: string;
  archived: boolean;
}): Promise<ActionResult> {
  await requireRole("admin");
  try {
    const repo = await getRepository();
    await repo.updateSubject(input.subjectId, { archived: input.archived });
    revalidatePath("/admin/subjects");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

const assignmentSchema = z.object({
  tutorId: z.string().min(1),
  studentId: z.string().min(1),
  subjectId: z.string().min(1),
});

export async function createAssignment(
  input: z.input<typeof assignmentSchema>,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a tutor, a student and a subject." };

  try {
    const repo = await getRepository();
    await repo.createAssignment(parsed.data);
    revalidatePath("/admin/assignments");
    revalidatePath("/admin/students");
    revalidatePath("/tutor/students");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setAssignmentActive(input: {
  assignmentId: string;
  active: boolean;
}): Promise<ActionResult> {
  await requireRole("admin");
  try {
    const repo = await getRepository();
    await repo.setAssignmentActive(input.assignmentId, input.active);
    revalidatePath("/admin/assignments");
    revalidatePath("/tutor/students");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setProfileActive(input: {
  profileId: string;
  active: boolean;
}): Promise<ActionResult> {
  await requireRole("admin");
  try {
    const repo = await getRepository();
    await repo.setProfileActive(input.profileId, input.active);
    revalidatePath("/admin/students");
    revalidatePath("/admin/tutors");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function addStudentSubject(input: {
  studentId: string;
  subjectId: string;
}): Promise<ActionResult> {
  await requireRole("admin");
  try {
    const repo = await getRepository();
    await repo.addStudentSubject(input.studentId, input.subjectId);
    revalidatePath(`/admin/students/${input.studentId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

const settingsSchema = z.object({
  notetakerEnabledGlobally: z.boolean().optional(),
  notetakerDisplayName: z.string().trim().min(1).max(80).optional(),
  requireGuardianConsentUnder18: z.boolean().optional(),
  transcriptRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  mediaRetentionHours: z.coerce.number().int().min(0).max(720).optional(),
});

export async function updateSettings(
  input: z.input<typeof settingsSchema>,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those settings could not be saved." };

  try {
    const repo = await getRepository();
    await repo.updateSettings(parsed.data);
    revalidatePath("/admin/settings");
    revalidatePath("/admin/notetaker");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/* -- invitations ----------------------------------------------------------
   Nobody signs themselves up. An admin sends an invitation, Supabase emails a
   one-time link, and the handle_new_user trigger creates the profile with the
   role carried in the invitation's metadata.
   ------------------------------------------------------------------------ */

const inviteSchema = z.object({
  email: z.email().max(255),
  firstName: z.string().trim().max(80),
  lastName: z.string().trim().max(80),
  role: z.enum(USER_ROLES),
});

export async function inviteUser(input: z.input<typeof inviteSchema>): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "A valid email address and role are required." };

  if (isDemoMode()) {
    return {
      ok: false,
      error:
        "Invitations need a Supabase project and a service-role key — they cannot be sent in demo mode.",
    };
  }
  if (!env.supabaseServiceRoleKey) {
    return {
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is not set, so invitations cannot be sent from this server.",
    };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo: `${env.appUrl}/auth/callback`,
      data: {
        role: parsed.data.role,
        first_name: parsed.data.firstName,
        last_name: parsed.data.lastName,
      },
    });
    if (error) {
      return {
        ok: false,
        error: /already been registered/i.test(error.message)
          ? "That email address already has an account."
          : "The invitation could not be sent. Check the address and try again.",
      };
    }

    revalidatePath("/admin/students");
    revalidatePath("/admin/tutors");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
