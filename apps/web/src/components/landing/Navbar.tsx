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
        <span className="max-md:hidden">Beacon: Flare AI OS. Signal → Quote → Policy → Pay → Execute → Receipt.</span>
        <span className="hidden max-md:inline">Signal to receipt on Flare.</span>
        <a href="#how" className="underline hover:opacity-80">
          Learn more →
        </a>
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
            <Link to="/flow" className="hover:text-ink">
              Flow
            </Link>
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <a href="#services" className="hover:text-ink">
              Services
            </a>
            <a href="#quality" className="hover:text-ink">
              Quality
            </a>
            <a href="#receipts" className="hover:text-ink">
              Receipts
            </a>
          </nav>

          <FacetCtaPair left="Open Flow" right="Start a job" leftTo="/flow" rightTo="/app" size="sm" />
        </div>
      </header>
    </>
  );
}
