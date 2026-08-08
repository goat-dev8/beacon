import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAppKit } from "@reown/appkit/react";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import {
  ensureCoston2Network,
  setEip1193Provider,
  type Eip1193Provider,
} from "@/lib/wallet";
import { waitForWagmiAddress } from "@/lib/reown";

type ProductWalletCtx = {
  wallet: Address | null;
  ready: boolean;
  connecting: boolean;
  connect: () => Promise<Address>;
  setWallet: (addr: Address | null) => void;
};

const Ctx = createContext<ProductWalletCtx | null>(null);

function asEip1193(value: unknown): Eip1193Provider | undefined {
  if (
    value &&
    typeof value === "object" &&
    "request" in value &&
    typeof (value as Eip1193Provider).request === "function"
  ) {
    return value as Eip1193Provider;
  }
  return undefined;
}

/**
 * One wallet session for Flow / Jobs / Safe via Reown AppKit.
 * Restores once at the shell so tab changes never flash "Connect".
 */
export function ProductWalletProvider({ children }: { children: ReactNode }) {
  const { open } = useAppKit();
  const { address, status, connector, isConnected } = useAccount();
  const [wallet, setWallet] = useState<Address | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Sync EIP-1193 provider from the active Reown / wagmi connector
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!connector) {
        setEip1193Provider(null);
        return;
      }
      try {
        const provider = asEip1193(await connector.getProvider());
        if (!cancelled) setEip1193Provider(provider ?? null);
      } catch {
        if (!cancelled) setEip1193Provider(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connector, address]);

  // Sync address from wagmi (includes reconnect on mount)
  useEffect(() => {
    if (address && isConnected) {
      const addr = getAddress(address);
      setWallet(addr);
      try {
        localStorage.setItem("beacon.wallet", addr);
      } catch {
        /* ignore */
      }
      void ensureCoston2Network().catch(() => {
        /* user may need to approve chain switch on first sign */
      });
    } else if (status === "disconnected") {
      setWallet(null);
      try {
        localStorage.removeItem("beacon.wallet");
      } catch {
        /* ignore */
      }
    }
    if (status !== "connecting" && status !== "reconnecting") {
      setReady(true);
    }
  }, [address, isConnected, status]);

  // Account change listener on active provider
  useEffect(() => {
    let cancelled = false;
    let provider: Eip1193Provider | undefined;
    let onAccounts: ((accounts: unknown) => void) | undefined;

    void (async () => {
      try {
        provider = connector ? asEip1193(await connector.getProvider()) : undefined;
      } catch {
        provider = undefined;
      }
      if (cancelled || !provider?.on) return;

      onAccounts = (accounts: unknown) => {
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
        try {
          setWallet(getAddress(list[0]));
        } catch {
          /* ignore */
        }
      };

      provider.on("accountsChanged", onAccounts);
    })();

    return () => {
      cancelled = true;
      if (provider && onAccounts) {
        provider.removeListener?.("accountsChanged", onAccounts);
      }
    };
  }, [connector]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      if (address) {
        const addr = getAddress(address);
        setWallet(addr);
        if (connector) {
          try {
            const provider = asEip1193(await connector.getProvider());
            setEip1193Provider(provider ?? null);
          } catch {
            /* ignore */
          }
        }
        await ensureCoston2Network().catch(() => undefined);
        return addr;
      }

      await open({ view: "Connect" });
      const addr = await waitForWagmiAddress();
      setWallet(addr);
      try {
        localStorage.setItem("beacon.wallet", addr);
      } catch {
        /* ignore */
      }
      await ensureCoston2Network().catch(() => undefined);
      return addr;
    } finally {
      setConnecting(false);
    }
  }, [address, connector, open]);

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
