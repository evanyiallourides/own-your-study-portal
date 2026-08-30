import type { Metadata } from "next";

import { SettingsForm } from "@/components/portal/admin-forms";
import { SectionHead } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettings() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);
  const settings = await repo.getSettings();

  return (
    <div className="space-y-8">
      <SectionHead
        as="h1"
        title="Settings"
        description="Organisation-wide switches. Per-student consent is on each student's record."
      />
      <SettingsForm settings={settings} />
    </div>
  );
}
