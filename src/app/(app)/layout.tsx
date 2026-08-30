import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SectionLabel } from "@/components/section-label";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const initial = user.email.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/80 px-6 backdrop-blur">
          <SectionLabel />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="flex items-center gap-2.5 rounded-full border border-border bg-card py-1 pl-1 pr-3 shadow-xs">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ember-soft text-xs font-semibold text-ember-soft-foreground">
                {initial}
              </span>
              <span className="text-sm text-muted-foreground">{user.email}</span>
            </div>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
