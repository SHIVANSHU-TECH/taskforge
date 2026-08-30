import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        ember: "border-transparent bg-ember-soft text-ember-soft-foreground",
        emerald:
          "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        red: "border-transparent bg-destructive/15 text-destructive dark:text-red-300",
        blue: "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-300",
        steel: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** Small pill for labels like source type, framework, or status. */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
