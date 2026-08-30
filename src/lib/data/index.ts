import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DemoRepository } from "@/lib/data/demo-repository";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import type { Repository } from "@/lib/data/repository";
import { requireSession } from "@/lib/auth/session";
import type { PortalSession } from "@/lib/types";

/** The repository for the signed-in user. Redirects to /login if there is none. */
export async function getRepository(): Promise<Repository> {
  const session = await requireSession();
  return repositoryFor(session);
}

export async function repositoryFor(session: PortalSession): Promise<Repository> {
  if (isDemoMode()) return new DemoRepository(session);
  const db = await createSupabaseServerClient();
  return new SupabaseRepository(db, session);
}

export type { Repository };
export { AccessDeniedError, NotFoundError } from "@/lib/data/repository";
