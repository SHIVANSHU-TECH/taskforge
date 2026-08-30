"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, FolderGit2, LayoutDashboard, LayoutTemplate, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workspaces", label: "Workspaces", icon: FolderGit2 },
  { href: "/recipes", label: "Task Recipes", icon: BookMarked },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/runs", label: "Runs", icon: PlayCircle },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 bg-sidebar p-4 text-sidebar-foreground">
      <Link href="/dashboard" className="flex items-center gap-3 px-2 py-3">
        <span className="forge-mark flex h-9 w-9 items-center justify-center rounded-lg font-display text-sm font-bold text-white">
          TF
        </span>
        <span className="flex flex-col leading-none">
          <span className="font-display text-[0.95rem] font-semibold tracking-tight text-white">
            TaskForge
          </span>
          <span className="eyebrow mt-1 text-sidebar-foreground/60">AI Console</span>
        </span>
      </Link>
      <nav className="mt-4 flex flex-col gap-1">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-white/5 font-medium text-white"
                  : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-ember transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? "text-ember" : "text-sidebar-foreground/70 group-hover:text-white",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-3 pt-4">
        <p className="eyebrow text-sidebar-foreground/40">Build v0.8 · Hardening</p>
      </div>
    </aside>
  );
}
