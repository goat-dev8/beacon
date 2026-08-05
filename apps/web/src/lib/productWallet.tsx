import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Address } from "viem";
import { connectEvmWallet, tryRestoreWallet } from "@/lib/wallet";

type ProductWalletCtx = {
  wallet: Address | null;
  ready: boolean;
  connecting: boolean;
  connect: () => Promise<Address>;
  setWallet: (addr: Address | null) => void;
};

const Ctx = createContext<ProductWalletCtx | null>(null);

/**
 * One wallet session for Flow / Bound Work / Security.
 * Restores once at the shell so tab changes never flash "Connect".
 */
export function ProductWalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Address | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = await tryRestoreWallet();
        if (!cancelled && restored) setWallet(restored);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;

    const onAccounts = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? (accounts as string[]) : [];
      if (!list[0]) {
        setWallet(null);
        try {
          localStorage.removeItem("beacon.wallet");
        } catch {
          /* ignore */
        }
        return;
      }
      void tryRestoreWallet().then((addr) => {
        if (addr) setWallet(addr);
      });
    };

    eth.on("accountsChanged", onAccounts);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const addr = await connectEvmWallet();
      setWallet(addr);
      return addr;
    } finally {
      setConnecting(false);
    }
  }, []);

  const value = useMemo<ProductWalletCtx>(
    () => ({ wallet, ready, connecting, connect, setWallet }),
    [wallet, ready, connecting, connect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProductWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProductWallet requires ProductWalletProvider");
  return ctx;
}
