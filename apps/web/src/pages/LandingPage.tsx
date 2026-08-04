import { Hero } from "@/components/landing/Hero";
import { Navbar } from "@/components/landing/Navbar";
import {
  ContractsSection,
  FinalCta,
  Footer,
  HowSection,
  QualityBand,
  QualitySection,
  ServicesSection,
} from "@/components/landing/Sections";

export function LandingPage() {
  return (
    <>
      <Navbar />
      <main className="pt-0">
        <Hero />
        <HowSection />
        <ServicesSection />
        <QualityBand />
        <QualitySection />
        <ContractsSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
