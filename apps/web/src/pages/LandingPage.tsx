import { Hero } from "@/components/landing/Hero";
import { Navbar } from "@/components/landing/Navbar";
import { ArchitectureStrip } from "@/components/landing/ArchitectureStrip";
import { WhyFlareSection } from "@/components/landing/WhyFlare";
import {
  ContractsSection,
  FinalCta,
  Footer,
  QualityBand,
  QualitySection,
  ServicesSection,
  WhatIsBeacon,
  WhoUsesSection,
  WhyAiFlareSection,
} from "@/components/landing/Sections";

export function LandingPage() {
  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <Navbar />
      <Hero />
      <WhatIsBeacon />
      <WhoUsesSection />
      <WhyAiFlareSection />
      <ArchitectureStrip />
      <WhyFlareSection />
      <ServicesSection />
      <QualityBand />
      <QualitySection />
      <ContractsSection />
      <FinalCta />
      <Footer />
    </main>
  );
}
