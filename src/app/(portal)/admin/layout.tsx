import { requireRole } from "@/lib/auth/session";

/**
 * The role gate for this whole section. Putting it in the layout rather than in
 * each page means a page added here later cannot forget it, and the redirect
 * happens before any of the section's own markup or metadata is resolved.
 *
 * This is a routing convenience, not the security boundary: the data itself is
 * protected by Row Level Security, so even with this removed the queries
 * underneath would return nothing.
 */
export default async function AdminSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("admin");
  return <>{children}</>;
}
