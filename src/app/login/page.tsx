import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — the forge floor. */}
      <div className="relative hidden overflow-hidden bg-sidebar text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="glow-ember pointer-events-none absolute inset-0" />
        <div className="bg-blueprint pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative flex items-center gap-3">
          <span className="forge-mark flex h-10 w-10 items-center justify-center rounded-lg font-display text-base font-bold text-white">
            TF
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">TaskForge AI</span>
        </div>
        <div className="relative max-w-md">
          <p className="eyebrow text-white/50">Internal automation platform</p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight">
            From client brief to shipped change,
            <span className="text-ember-gradient"> forged automatically.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Ingest a project, pick a recipe, and let the engine plan, apply, and validate the work
            in a sandbox before delivery.
          </p>
        </div>
        <div className="relative flex items-center gap-6 text-xs text-white/40">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ember" /> Analyze
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ember" /> Apply
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ember" /> Validate
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ember" /> Deliver
          </span>
        </div>
      </div>

      {/* Sign-in panel. */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="forge-mark flex h-9 w-9 items-center justify-center rounded-lg font-display text-sm font-bold text-white">
              TF
            </span>
            <span className="font-display text-base font-semibold tracking-tight">TaskForge AI</span>
          </div>
          <p className="eyebrow text-muted-foreground/70">Welcome back</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Sign in to the console
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your workspace credentials to continue.
          </p>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
