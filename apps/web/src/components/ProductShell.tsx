import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { Briefcase, ExternalLink, Moon, Shield, Sparkles, Sun } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ProductThemeProvider, useProductTheme } from "@/lib/productTheme";
import { BeaconMark } from "@/components/diagrams/BeaconDiagrams";
import { NETWORK } from "@/lib/chain";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/flow", end: true, label: "Flow", icon: Sparkles },
  { to: "/flow/desk", end: false, label: "Work", icon: Briefcase },
  { to: "/flow/security", end: false, label: "Policy", icon: Shield },
];

function RailLink({
  to,
  end,
  label,
  icon: Icon,
}: {
  to: string;
  end: boolean;
  label: string;
  icon: typeof Sparkles;
}) {
  return (
    <NavLink to={to} end={end} className="group relative block w-full px-2 py-1">
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="rail-active"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="absolute inset-x-2 inset-y-1 rounded-[var(--p-radius-sm)] bg-[var(--p-accent-soft)]"
            />
          )}
          <span
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-[var(--p-radius-sm)] py-2 transition-colors duration-200",
              isActive
                ? "text-[var(--p-accent-text)]"
                : "text-[var(--p-faint)] group-hover:bg-[var(--p-hover)] group-hover:text-[var(--p-fg)]",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em]">{label}</span>
          </span>
        </>
      )}
    </NavLink>
  );
}

function ShellChrome() {
  const { theme, toggle } = useProductTheme();
  const location = useLocation();
  const reduce = useReducedMotion();

  // Sub-routes of the desk share one surface, so transitions key on the top segment only.
  const routeKey = location.pathname.startsWith("/flow/desk")
    ? "desk"
    : location.pathname.startsWith("/flow/security")
      ? "security"
      : "flow";

  return (
    <div className="product-shell flex h-dvh max-h-dvh overflow-hidden" data-theme={theme}>
      <aside className="flex w-[62px] shrink-0 flex-col items-stretch border-r border-[var(--p-border)] bg-[var(--p-rail)] py-3">
        <Link
          to="/"
          className="mx-auto mb-3 grid size-9 place-items-center rounded-[var(--p-radius-sm)] bg-[var(--p-accent)] text-[var(--p-on-accent)] transition-transform duration-200 hover:scale-[1.04] active:scale-[0.97]"
          title="Beacon home"
          aria-label="Beacon home"
        >
          <BeaconMark className="size-5" />
        </Link>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <RailLink key={item.to} {...item} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            className="grid size-9 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-faint)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="size-[18px]" strokeWidth={1.75} />
            ) : (
              <Moon className="size-[18px]" strokeWidth={1.75} />
            )}
          </button>
          <a
            href={NETWORK.explorer}
            target="_blank"
            rel="noreferrer"
            className="grid size-9 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-faint)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
            title="Coston2 explorer"
            aria-label="Coston2 explorer"
          >
            <ExternalLink className="size-[18px]" strokeWidth={1.75} />
          </a>
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={routeKey}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Shared product chrome for Flow / Bound Work / Security. The shell is never abandoned. */
export function ProductShell() {
  return (
    <ProductThemeProvider>
      <ShellChrome />
    </ProductThemeProvider>
  );
}
