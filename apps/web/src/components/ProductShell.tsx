import { NavLink, Outlet, Link } from "react-router-dom";
import { Briefcase, ExternalLink, Hexagon, Moon, Shield, Sparkles, Sun } from "lucide-react";
import { ProductThemeProvider, useProductTheme } from "@/lib/productTheme";
import { NETWORK } from "@/lib/chain";
import { cn } from "@/lib/utils";

function ShellChrome() {
  const { theme, toggle } = useProductTheme();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "grid size-9 place-items-center rounded-xl transition-colors",
      isActive
        ? "bg-[var(--p-accent-soft)] text-[var(--p-accent)]"
        : "text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]",
    );

  return (
    <div
      className="product-shell flex h-dvh max-h-dvh overflow-hidden"
      data-theme={theme}
    >
      <aside className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-[var(--p-border)] bg-[var(--p-rail)] py-4">
        <Link
          to="/"
          className="grid size-9 place-items-center rounded-xl bg-[var(--p-accent)] text-[var(--p-on-accent)]"
          title="Beacon home"
        >
          <Hexagon className="size-5" />
        </Link>
        <NavLink to="/flow" end className={linkClass} title="Flow">
          <Sparkles className="size-4" />
        </NavLink>
        <NavLink to="/flow/desk" className={linkClass} title="Bound Work">
          <Briefcase className="size-4" />
        </NavLink>
        <NavLink to="/flow/security" className={linkClass} title="Security">
          <Shield className="size-4" />
        </NavLink>
        <button
          type="button"
          onClick={toggle}
          className="mt-auto grid size-9 place-items-center rounded-xl text-[var(--p-muted)] hover:bg-[var(--p-hover)]"
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <a
          href={NETWORK.explorer}
          target="_blank"
          rel="noreferrer"
          className="grid size-9 place-items-center rounded-xl text-[var(--p-muted)] hover:bg-[var(--p-hover)]"
          title="Explorer"
        >
          <ExternalLink className="size-4" />
        </a>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

/** Shared product chrome for Flow / Bound Work / Security — never abandon the OS shell. */
export function ProductShell() {
  return (
    <ProductThemeProvider>
      <ShellChrome />
    </ProductThemeProvider>
  );
}
