import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** 404 page. Rendered inside the root layout, so the theme + fonts apply. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow text-muted-foreground/70">404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
      </p>
      <div className="mt-6">
        <Link href="/dashboard" className={buttonVariants()}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

