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
      <p className="flex items-center gap-2 text-center font-mono text-sm font-medium tracking-[0.35px] text-ink max-md:text-[0.6875rem]">
        <span className="max-md:hidden">Beacon: Flare AI OS. Signal to Quote to Policy to Pay to Execute to Receipt.</span>
        <span className="hidden max-md:inline">Signal to receipt on Flare.</span>
        <Link to="/start" className="underline hover:opacity-80">
          Get Started
        </Link>
      </p>
    </div>
  );
}

export function Navbar() {
  return (
    <>
      <AnnouncementBar />
      <header className="sticky top-11 z-50 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5">
          <Link to="/" className="inline-flex items-center gap-2.5 text-ink" aria-label="Beacon home">
            <BeaconMark className="size-7 text-ink" />
            <span className="font-display text-lg font-bold tracking-tight">Beacon</span>
          </Link>

          <nav className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted lg:flex">
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
