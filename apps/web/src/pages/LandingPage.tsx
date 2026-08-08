import { Hero, HeroTrustStrip } from "@/components/landing/Hero";
import { Navbar } from "@/components/landing/Navbar";
import { ArchitectureStrip } from "@/components/landing/ArchitectureStrip";
import { WhyFlareSection } from "@/components/landing/WhyFlare";
import { StoryHowItWorks } from "@/components/landing/StoryHowItWorks";
import { ProtectionStory } from "@/components/landing/ProtectionStory";
import {
  ContractsSection,
  FinalCta,
  Footer,
  WhatIsBeacon,
} from "@/components/landing/Sections";

export function LandingPage() {
  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <Navbar />
      <Hero />
      <HeroTrustStrip />
      <WhatIsBeacon />
      <StoryHowItWorks />
      <ArchitectureStrip />
      <ProtectionStory />
      <WhyFlareSection />
      <ContractsSection />
      <FinalCta />
      <Footer />
    </main>
  );
}
