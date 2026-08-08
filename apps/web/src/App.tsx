import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { LandingPage } from "@/pages/LandingPage";
import { ProductShell } from "@/components/ProductShell";
import { wagmiConfig } from "@/lib/reown";

const GetStartedPage = lazy(() =>
  import("@/pages/GetStartedPage").then((m) => ({ default: m.GetStartedPage })),
);
const AppPage = lazy(() =>
  import("@/pages/AppPage").then((m) => ({ default: m.AppPage })),
);
const DeskPage = lazy(() =>
  import("@/pages/DeskPage").then((m) => ({ default: m.DeskPage })),
);
const FlowPage = lazy(() =>
  import("@/pages/FlowPage").then((m) => ({ default: m.FlowPage })),
);
const SecurityPage = lazy(() =>
  import("@/pages/SecurityPage").then((m) => ({ default: m.SecurityPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--p-bg,#0a0c0b)] text-sm text-[var(--p-muted,#9a96a8)]">
      Loading Beacon…
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/start"
            element={
              <Suspense fallback={<RouteFallback />}>
                <GetStartedPage />
              </Suspense>
            }
          />
          {/* Legacy desk URL → stay inside product shell */}
          <Route path="/app" element={<Navigate to="/flow/desk" replace />} />
          <Route
            path="/flow"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ProductShell />
              </Suspense>
            }
          >
            <Route
              index
              element={
                <Suspense fallback={<RouteFallback />}>
                  <FlowPage />
                </Suspense>
              }
            />
            <Route
              path="desk"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <DeskPage />
                </Suspense>
              }
            />
            <Route
              path="security"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <SecurityPage />
                </Suspense>
              }
            />
          </Route>
          {/* Keep bare AppPage available only via redirect */}
          <Route
            path="/desk-legacy"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AppPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
