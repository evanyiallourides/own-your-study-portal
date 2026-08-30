import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/* ==========================================================================
   OpenNext — Cloudflare
   --------------------------------------------------------------------------
   Deliberately bare.

   The usual reason this file grows is the incremental cache, which needs an R2
   bucket and a KV namespace to coordinate. This portal has no use for one:
   every page that shows a person's own data is `dynamic = "force-dynamic"`
   (47 of 55 route files), there is no `revalidate` anywhere, and the pages
   that are static are the login screen and the error boundaries. Wiring up R2
   would add a bucket, a binding and a monthly line item to cache four pages
   that never change.

   If that stops being true — a public marketing route inside the portal, or a
   page that can be cached per-tenant — add r2IncrementalCache here and create
   the bucket. Until then this is the honest configuration.
   ========================================================================== */

export default defineCloudflareConfig();
