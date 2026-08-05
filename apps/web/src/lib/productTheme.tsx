import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ProductTheme = "dark" | "light";

type ThemeCtx = {
  theme: ProductTheme;
  setTheme: (t: ProductTheme) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = "beacon.productTheme";

export function ProductThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ProductTheme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* ignore */
    }
    return "dark";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.productTheme = theme;
  }, [theme]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProductTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProductTheme requires ProductThemeProvider");
  return ctx;
}
