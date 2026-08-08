import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";
import { flareTestnet, type AppKitNetwork } from "@reown/appkit/networks";
import { getAddress, type Address } from "viem";
import { getAccount, watchAccount } from "wagmi/actions";

/** Public Reown Cloud project id — safe for client bundles. */
export const REOWN_PROJECT_ID =
  (import.meta.env.VITE_REOWN_PROJECT_ID as string | undefined)?.trim() ||
  (import.meta.env.VITE_PROJECT_ID as string | undefined)?.trim() ||
  "5f50ddf3aa17cc1fb435598a4eada801";

const metadata = {
  name: "Beacon",
  description: "Flare AI OS — where intent becomes proof.",
  url: typeof window !== "undefined" ? window.location.origin : "https://beacon-desk.vercel.app",
  icons: ["https://beacon-desk.vercel.app/brand/logo-mark.png"],
};

/** Coston2 only — Beacon product rails stay on chain 114. */
export const networks = [flareTestnet] as [AppKitNetwork, ...AppKitNetwork[]];

export const wagmiAdapter = new WagmiAdapter({
  projectId: REOWN_PROJECT_ID,
  networks,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: flareTestnet,
  projectId: REOWN_PROJECT_ID,
  metadata,
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#39e08a",
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});

/** Wait until wagmi reports an address after the Reown modal opens. */
export function waitForWagmiAddress(timeoutMs = 120_000): Promise<Address> {
  const config = wagmiConfig;
  const current = getAccount(config);
  if (current.address) return Promise.resolve(getAddress(current.address));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unwatch();
      reject(new Error("Wallet connection cancelled or timed out."));
    }, timeoutMs);

    const unwatch = watchAccount(config, {
      onChange(account) {
        if (account.address) {
          clearTimeout(timer);
          unwatch();
          resolve(getAddress(account.address));
        }
      },
    });
  });
}
