import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { DemoAccountPicker } from "@/components/auth/demo-account-picker";
import { LoginForm } from "@/components/auth/login-form";
import { Brand } from "@/components/portal/brand";
import { ShieldIcon } from "@/components/ui/icons";
import { getPortalSession, HOME_FOR_ROLE } from "@/lib/auth/session";
import { demoState } from "@/lib/data/demo-store";
import { env, isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getPortalSession();
  if (session) redirect(HOME_FOR_ROLE[session.profile.role]);

  const demo = isDemoMode();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1fr_minmax(0,30rem)]">
      {/* -- The left half is brand, and on a phone it collapses to the mark
             alone rather than shrinking a photograph into a stripe. -- */}
      <section className="relative hidden overflow-hidden bg-ink px-12 py-16 lg:flex lg:flex-col lg:justify-between">
        <Image
          src="/brand/mark-white.png"
          alt=""
          width={977}
          height={1022}
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-16 w-[38rem] opacity-[0.06]"
        />
        <div className="relative">
          <p className="font-display text-2xl font-semibold text-paper">Own Your Study</p>
        </div>

        <div className="relative max-w-lg">
          <h1 className="font-display text-[clamp(2.2rem,3.4vw,3.2rem)] leading-[1.08] font-semibold text-paper">
            Every lesson, written up and kept.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-[#b6c0d2]">
            Notes, transcripts and the board from each session — reviewed by your tutor before you
            see them, and there whenever you need to go back over something.
          </p>
        </div>

        <p className="relative text-sm text-[#8b96a8]">
          Private portal · {env.marketingSiteUrl.replace(/^https?:\/\//, "")}
        </p>
      </section>

      {/* -- Sign in -- */}
      <section className="flex min-h-screen flex-col justify-center px-5 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="lg:hidden">
            <Brand href="/login" />
          </div>

          <div className="mt-10 lg:mt-0">
            <h2 className="font-display text-3xl font-semibold">Log in</h2>
            <p className="mt-2 text-ink-500">
              {demo
                ? "This portal is running on demo data. Choose which account to look through."
                : "Use the email address your tutor or coordinator set your account up with."}
            </p>
          </div>

          <div className="mt-8">
            {demo ? (
              <DemoAccountPicker profiles={demoState.profiles} />
            ) : (
              <LoginForm appUrl={env.appUrl} />
            )}
          </div>

          {demo ? (
            <div className="mt-8 rounded-[14px] border border-warning/25 bg-warning-wash px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                <ShieldIcon className="h-4 w-4" />
                Demo mode
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                Every person, lesson and transcript here is invented. No Supabase project is
                configured, so nothing is stored and no real student data is involved. Set{" "}
                <code className="rounded bg-paper-2 px-1 py-0.5 text-[0.8em]">
                  NEXT_PUBLIC_SUPABASE_URL
                </code>{" "}
                and{" "}
                <code className="rounded bg-paper-2 px-1 py-0.5 text-[0.8em]">
                  NEXT_PUBLIC_SUPABASE_ANON_KEY
                </code>{" "}
                to run against a real database.
              </p>
            </div>
          ) : null}

          <p className="mt-10 text-sm text-ink-300">
            Trouble getting in? Email{" "}
            <a
              href="mailto:hello@ownyourstudy.com"
              className="font-medium text-ink-500 hover:text-accent hover:underline"
            >
              hello@ownyourstudy.com
            </a>{" "}
            and we will sort it out.
          </p>
          <p className="mt-3 text-sm">
            <a
              href={env.marketingSiteUrl}
              className="text-ink-300 transition-colors hover:text-accent hover:underline"
            >
              ← Back to ownyourstudy.com
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
