import { Link } from "react-router-dom";
import { BeaconMark } from "@/components/diagrams/BeaconDiagrams";
import { FacetCtaPair } from "@/components/ui/Button";

export function AnnouncementBar() {
  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex h-11 items-center justify-center bg-signal px-4"
      role="region"
      aria-label="Announcement"
    >
        <p className="flex flex-wrap items-center justify-center gap-2 text-center font-mono text-sm font-medium tracking-[0.35px] text-ink max-md:text-[0.6875rem]">
        <span className="max-md:hidden">Beacon on Flare: FTSO signal, Safe policy, x402 settle, explorer proof.</span>
        <span className="hidden max-md:inline">Beacon on Flare. Signal to proof.</span>
        <Link to="/start" className="underline hover:opacity-80">
          Get Started
        </Link>
      </p>
    </div>
  );
}

/** Greptile-style sticky nav: white surface, mono caps, facet CTAs */
export function Navbar() {
  return (
    <>
      <AnnouncementBar />
      <header className="sticky top-11 z-50 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-5 md:px-8">
          <Link to="/" className="inline-flex items-center gap-2.5 text-ink" aria-label="Beacon home">
            <BeaconMark className="size-7 text-ink" />
            <span className="font-display text-lg font-bold tracking-tight">Beacon</span>
          </Link>

          <nav className="hidden items-center gap-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted lg:flex">
            <a href="#story" className="hover:text-ink">
              Story
            </a>
            <a href="#architecture" className="hover:text-ink">
              Path
            </a>
            <a href="#protect" className="hover:text-ink">
              Protect
            </a>
            <a href="#why-flare" className="hover:text-ink">
              Why Flare
            </a>
            <Link to="/flow" className="hover:text-ink">
              Flow
            </Link>
          </nav>

          <FacetCtaPair left="Get Started" right="Open Flow" leftTo="/start" rightTo="/flow" size="sm" />
        </div>
      </header>
    </>
  );
}
