import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-display text-sm font-medium tracking-tight transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 disabled:pointer-events-none disabled:opacity-45 active:opacity-90",
  {
    variants: {
      variant: {
        signal: "bg-signal text-ink clip-facet-right hover:brightness-105",
        ink: "bg-dusk text-paper clip-facet-left hover:bg-dusk-2",
        ghost: "rounded-full border border-line bg-surface text-ink hover:bg-paper-2",
        soft: "rounded-full bg-paper-2 text-ink hover:bg-line",
        danger: "rounded-full bg-danger/10 text-danger border border-danger/30",
        rose: "rounded-full bg-rose/90 text-ink px-4",
      },
      size: {
        sm: "h-9 px-5",
        md: "h-11 px-6",
        lg: "h-12 px-7 text-base",
        icon: "size-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "signal",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };

/** Interlocking faceted CTA pair — Greptile-quality, Beacon copy */
export function FacetCtaPair({
  left,
  right,
  leftTo,
  rightTo,
  size = "lg",
}: {
  left: string;
  right: string;
  leftTo?: string;
  rightTo?: string;
  size?: "sm" | "md" | "lg";
}) {
  const pad =
    size === "lg" ? "py-2.5 px-7 text-sm" : size === "md" ? "py-2 px-5 text-sm" : "py-1.5 px-4 text-xs";
  const LeftTag = leftTo ? "a" : "span";
  const RightTag = rightTo ? "a" : "span";
  return (
    <div className="flex items-center">
      <LeftTag
        href={leftTo}
        className={cn(
          "relative isolate inline-flex items-center justify-center bg-dusk font-display text-paper clip-facet-left",
          pad,
        )}
      >
        {left}
      </LeftTag>
      <RightTag
        href={rightTo}
        className={cn(
          "relative z-[1] -ml-1.5 inline-flex items-center justify-center bg-signal font-display text-ink clip-facet-right",
          pad,
        )}
      >
        {right}
      </RightTag>
    </div>
  );
}
