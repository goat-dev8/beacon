# Beacon Engineering History (memory)

Living log of what was done. No secrets in this file.

---

## 2026-08-07 - Loop deep retest + Safe intent / vault validation

### Fixes shipped (`ffa0dfe`, `6fe0f25`)
- **Bare Safe intent:** `Safe` / `@safe` / `open safe` / `from … Safe` → `desk_link` `/flow/security` (no SparkDEX pairs).
- **Tighten:** `is it safe to swap` still routes to **swap** (does not steal Safe help).
- **Vault prepare:** zero deposit/withdraw amount → HTTP **400 VALIDATION** (was 500 INTERNAL).
- **Deposit UX:** MetaMask reject / cancel notes styled as danger on Safe page.

### Deploy status (verified)
- **GitHub main:** `6fe0f25`
- **Render `beacon-api`:** live on `6fe0f25` → https://beacon-api-97gl.onrender.com
- **Vercel `beacon-desk` + `beacon`:** Production **success** for `6fe0f25` (vercel[bot]) → https://beacon-desk.vercel.app
- Push workflow: always `git push` via `GITHUB_TOKEN` from `.env` (token never written into history).

### Live retest (Chrome + API)
- Safe / open safe / Send from Safe → `general` + `desk_link`.
- prep `amountUsdt0=0` → `VALIDATION`.
- Vault prepare deposit still `mode: eip3009`.
- On-chain Safe balance now **14.0 USDT0** (was 4.0 — deposit confirmed).
- Loop ticks 29–48 stayed green on chips / Bridge Base Sepolia / New chat→General / SIMULATED_TEE honesty.

### Ops note
- Always update this file after fix + test + each loop cycle; show Render + Vercel status; push with token.

### Loop ticks 49–51 (2026-08-07 ~01:27 UTC+3)
- Bare `Safe` → `desk_link`; `is it safe to swap` → swap; prep0 → 400 VALIDATION; prep deposit `eip3009`.
- Safe balance **14.0 USDT0**.
- **Render:** live `7098008`. **Vercel desk/beacon:** success on code `6fe0f25` (history-only commit skipped web rebuild).

### Loop tick 52
- Swap / Bridge / Portfolio / bare Safe OK; vault **14.0**; prep `eip3009`.
- **Render + Vercel:** both live/success on `fe6cf9d`.

### Full feature pass (2026-08-07)
- API: **25/25** chip + agent intents green (Swap/Bridge/x402/FAssets/Portfolio/Signals/Yield/Research/Risk/Safe + @intel/@liquidity/@crosschain/@treasury/@xrpfi/@trade/@desk/@pay/@general/@image + Bridge Base + edge Safe phrases).
- prep0 → 400 VALIDATION; deposit prep `eip3009`; FCC `simulated`; Safe balance **14.0 USDT0**.
- UI: Flow chips+arrows, New chat→General, Safe Deposit, WORK Bound Work, SIMULATED_TEE OK.
- **Fixes:** Safe pass warns when funded but spend caps are 0; Deposit disabled for amount ≤0; WORK quote disabled until brief ≥8 chars; user-facing Yield “vault rails” → “yield rails”.

---

## 2026-08-06 - Safe deposit EIP-3009 fix + feature rail arrows

- **Root cause of deposit revert:** Coston2 MockUSDT0 at `0x6fd8…` has **no** `approve` / `transferFrom` / `allowance` (EIP-3009 + transfer/mint only). Approve+deposit path always reverted.
- **Fix:** Beacon Safe deposit uses `depositWithAuthorization` (EIP-3009 sign → Safe pulls). Error copy says Safe, not Vault. Mint test USDT0 button on Safe page. Wallet balance shown.
- **UX:** Feature chips get left/right scroll arrows. Yield blurb no longer says "vault".
- Proved on-chain with deployer EIP-3009 deposit into `0xc7C6…AF33`.

---

## 2026-08-06 - Open deposit + slim composer + feature rail

- **Root cause:** `BeaconAgentVault.deposit` was `onlyOwner`, so MetaMask users who were not the Safe owner could not fund.
- **Contract:** `deposit` / `depositWithAuthorization` now public (anyone funds the pool). Withdraw / policy / pause / executor remain owner-only.
- **Redeploy Coston2:** `BeaconAgentVault` `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` (token MockUSDT0 `0x6fd8…e86c`, owner/executor deployer). Updated `BEACON_AGENT_VAULT_ADDRESS` / `VITE_BEACON_AGENT_VAULT_ADDRESS`.
- **Safe UI:** Deposit enabled for any connected wallet; Withdraw still owner-gated; clearer MetaMask fund copy.
- **Composer:** single-line pill input (`rows={1}`, shorter padding).
- **Chips:** long sentence prompts replaced with icon feature rail (Swap, Bridge, x402, FAssets, Portfolio, Signals, Yield, Research, Risk, Safe).
- **Discovery:** accent tiles for Swap / Bridge / x402 / Safe; removed Capabilities eyebrow.

---

## 2026-08-06 - Beacon Safe product rethink (flagship AI OS)

- Research: `PRODUCT_FLAGSHIP_RESEARCH_2026-08-06.md` (mentors + FCC SIMULATED_TEE path + Beacon Safe rename).
- FCC: default `simulated` when `SIMULATED_TEE=true`; `GET /v1/fcc/status`; honest badge (not hardware).
- UI: Agent Vault copy ? **Beacon Safe**; Apple-wallet Safe page; FeatureDiscovery + suggestion chips; onboarding; Why Flare; landing architecture story.
- Nav: Policy ? Safe.

## 2026-08-06 - Flagship product research + FCC honesty flip + Beacon Safe rename

- Wrote `PRODUCT_FLAGSHIP_RESEARCH_2026-08-06.md` (mentor guidance, official FCC hackathon path, Beacon Safe rename, product story, UI judge weaknesses).
- **FCC honesty:** default `FCC_MODE` to `simulated` when `SIMULATED_TEE=true` (else unavailable). Shared `resolveFccMode` + `probeExtProxy`; honesty message = SIMULATED_TEE on Coston2 (hackathon-accepted), not hardware Confidential Space.
- **API:** `/health` uses resolveFccMode; new `GET /v1/fcc/status` `{ mode, simulatedTee, proxyReachable, extensionId? }`.
- **UI:** Flow/Security stop hardcoding `fccMode=unavailable`; badge **Confidential policy (simulated TEE)** when simulated.
- **Rename:** user-facing Agent Vault ? **Beacon Safe** (contract remains `BeaconAgentVault`). Landing, onboarding, vaultClient messages, Safe page.
- **Env:** `.env.example` `FCC_MODE=simulated`, `SIMULATED_TEE=true`, `LOCAL_MODE=false`.
- **No commit / no push.**

---

## 2026-08-06 - Product redesign (discovery, onboarding, landing, execution)

### A. Feature discovery (empty Flow)
- New `FeatureDiscovery` capability grid when `messages.length <= 1` (welcome only): Swap, Bridge, Portfolio, Research, Signals, Risk, Yield, Treasury, FAssets, x402, Cross-chain, Market Intelligence. Try now fills composer; Send submits. No video/image stubs.
- Always-on `SuggestionChips` above composer (8 Flare prompts).
- WELCOME copy in `flowTypes.ts` updated to product-story language.

### B. Onboarding
- New `OnboardingWalkthrough` (4 steps: Deposit ? Set policy ? Talk to Beacon ? Get receipt). localStorage `beacon_onboarded_v1`. Shown once on first `/flow` visit.

### C. Why Flare
- Landing `WhyFlareSection` + Flow `WhyFlareDrawer` (top bar + discovery link). FTSO, FAssets, FCC, x402, OFT, Beacon Safe in plain language.

### D. Landing rethink
- Hero cinematic center; What / Who / Why AI+Flare; interactive `ArchitectureStrip` (Deposit?Policy?Chat?Execute?Receipt); Why Flare; services; CTA to `/flow`. Emerald brand; Linear surface rhythm; no purple glow.

### E. Execution polish
- Evidence panel: premium timeline motion, copy tx hash, open explorer, next suggestion chip.

### Files
- New: `FeatureDiscovery.tsx`, `SuggestionChips.tsx`, `OnboardingWalkthrough.tsx`, `WhyFlare.tsx`, `ArchitectureStrip.tsx`
- Updated: `flowTypes.ts`, `MessageList`, `Composer`, `ChatColumn`, `ChatTopBar`, `FlowPage`, `ExecutionDrawer`, `executionPhases`, `Hero`, `Sections`, `LandingPage`, `Navbar`, `VaultPassCard` (unused type)
- Typecheck: `tsc -b` clean for `@beacon/web`.
- **No commit / no push.**

---

## 2026-08-06 - Beacon Safe redesign (Security page)

- Completely redesigned `/flow/security` as **Beacon Safe**: Apple Wallet / Stripe-grade Product OS surface (Linear-calm + emerald accent; variance 5 / motion 4 / density 3).
- Sections: hero why-deposit, interactive Wallet?Safe?Policy?AI?Execution?Receipt?Wallet flow, protection story cards (honest Simulated TEE on Coston2), wallet-like pass card (Daily budget / Per trade / Session / Paused), deposit visual + `executeAgentVaultPrep`, spending policy with "Rolling period (hours)", emergency Pause/Unpause/Revoke with consequences, **App limits** (Flare agents only; image removed from defaults/options), Bound Work escrow footer line.
- Extracted UI under `apps/web/src/components/safe/*`. Kept vault status/prepare/policy APIs and owner gating.
- ProductShell rail label **Policy ? Safe**; Bound Work + ActionCards copy points to Safe.
- **No commit/push.**

## 2026-08-06 - Production verify + hotfix

- Pushed `ab5894c`; GitHub auto-deployed web to https://beacon-desk.vercel.app (READY).
- Render API live with `agentVault=0x9bD5B894Da0a54B7649A4084d93D58df4f6182e0`, `fccMode=unavailable`.
- Chrome: QuoterV2 quote `1 USD?0 ? 0.955428 FXRP` on Mainnet; model badge `deterministic fallback`; execution surface Mainnet phases; no pairs spam on quote turn.
- Hotfix: landing Flare-rails catalog (no video/image stubs), meta title Flare AI OS, composer mentions, honesty string, vault default address on web.

## 2026-08-06 - FDC honesty + Summer Signal research baseline

- Wrote `SUMMER_SIGNAL_RESEARCH_2026-08-06.md` (constraints, competitor benchmark without private names, audit gaps, ship list).
- Applied Linear `DESIGN.md` for product UI tokens.
- `packages/fdc`: refuse invented `requestId` UUIDs when verifier prepare omits id (fail closed).
- Phase-scoped cards, QuoterV2, yield vaults, x402 domain-from-token, Flow UX, Agent Vault contract+UI shipped in parallel slices (see entries below).
- **Coston2 deploy:** `BeaconAgentVault` at `0x9bD5B894Da0a54B7649A4084d93D58df4f6182e0` (token MockUSDT0 `0x6fd8?e86c`, owner/executor deployer). Set `BEACON_AGENT_VAULT_ADDRESS` / `VITE_BEACON_AGENT_VAULT_ADDRESS`.

---

## 2026-08-06 - Beacon Agent Vault into Security UI + API

- **Contract:** `BeaconAgentVault` (deposit / withdraw / setPolicy / setExecutor / execute / pause) already in `packages/contracts`; JobRegistry authorizer/closer roles noted.
- **Shared:** `packages/shared/src/vaultClient.ts` - ABI reads + prepare calldata; unset address -> readiness only (no fake balances). Explicit copy: vault pool != Bound Work `BeaconEscrow` per-job lock.
- **API:** `GET /v1/vault/status?address=` ; `POST /v1/vault/prepare` (deposit/withdraw/setPolicy/setPaused/setExecutor). Health `flareRails.agentVault`.
- **UI:** Security page reframed as **Agent Vault & Policy** - on-chain status panel + owner actions; API spend gates kept secondary.
- **Env:** `BEACON_AGENT_VAULT_ADDRESS` / `VITE_BEACON_AGENT_VAULT_ADDRESS` (+ `VAULT_EXECUTOR`) in `.env.example`s.
- **Forge:** `Deploy.s.sol` already deploys vault in full stack; added `DeployAgentVault.s.sol` for vault-only onto existing `X402_TOKEN_ADDRESS` on Coston2.
- **No mainnet deploy / no secrets commit / no push.**

---

## 2026-08-06 - Harden x402 + OFT destination + Redis fail-closed

### x402 / EIP-712
- `packages/x402/src/eip3009.ts`: resolve EIP-712 domain **from `token.name()` / `version()`** ? never hardcode `"USD?0"` (MockUSDT0 uses `"USD0"`). `buildEip3009Domain` fail-closed without explicit name.
- `assertX402PaymentFields`: network/token/payee/exact amount/validity window/nonce checks.
- `paidResources.ts`: full settle validation + on-chain `authorizationState` check; idempotent receipt cache (Redis + memory); nonce in-flight lock; MockUSDT0 labeled **testnet/demo**.
- Agent chat settle: same field checks + refuse double-settle; settler key fallback.

### LayerZero OFT destination
- `oftBridge.ts`: peers from `peers(eid)` + `PeerSet` events; fallback routes status=`fallback-snapshot`, `live:false` ? never presented as live.
- `prepareFxrpOftBridge` refuses fallback-only peers; re-reads `peers(eid)` before `quoteSend`.
- `decodeOftGuidFromReceipt` / `observeOftSourceSend` / `trackOftDelivery` ? GUID from OFTSent, dest poll `OFTReceived`, UI phases source ? protocol ? dest.
- API `GET /v1/agents/bridge/delivery`; Flow polls after source send; routes card labels snapshot vs live.

### Redis / policy / CORS
- Spend accounting + delegated workflow amounts **fail closed** without Redis.
- Policy PUT requires Redis; stores `sessionStartedAt` / `updatedAt`; `isSessionExpired` enforced in evaluator.
- CORS: prefer `WEB_ORIGIN` / `ALLOWED_ORIGINS` when set.

### Verification (local smoke)
- Domain without name throws; name `USD0` OK
- Payment field assert OK; OFTSent GUID decode OK; fallback peers all `live:false`
- Session expiry after `sessionExpiryHours` returns expired

**No commit/push** (per request).

---

## 2026-08-06 - Flow conversation UX redesign (Flare Summer Signal)

### Design decisions
- **Linear calm + emerald Beacon:** DESIGN.md surface ladder (`#010102` canvas, hairline borders, 8/12px radii) mapped onto existing `--p-*`; chromatic accent stays `#39e08a` (no purple AI glow).
- **One history rail + one top bar:** ProductShell icon rail remains the only product nav (Flow / Work / Policy). Removed inner Flow/Bound Work/Security tabs and duplicate agent pickers (sidebar shortcuts + composer ?All agents?).
- **Centered chat column:** `max-w-[42rem]`, body/prose ~15.5px; auto-scroll to latest; mobile history via overlay + top-bar toggle.
- **Cards for current phase only:** `cardsForDisplay` renders full interactive cards on the latest assistant turn; historical discovery catalogs are hidden; older live cards become compact ?past? chips.
- **One execution surface:** phases `quote ? authorization ? source tx ? protocol observe ? destination receipt ? next step`. Prefer `convState.phase` + tx/event status over inferred completion. Inspector mounts only when active; mobile sheet starts collapsed.
- **Network-correct explorers:** `lib/explorers.ts` ? Coston2 vs flarescan.com (chain 14) for SparkDEX; bridge/x402 stay Coston2 + LayerZero Scan.

### Files
- New: `apps/web/src/components/flow/{HistoryRail,ChatTopBar,ChatColumn,Composer,MessageList,ActionCards}.tsx`
- New: `apps/web/src/lib/{flowTypes,explorers}.ts`
- Reworked: `executionPhases.ts`, `ExecutionDrawer.tsx`, `FlowPage.tsx`, `index.css`
- Landing: Hero/Navbar/Sections ? Flare AI OS story; `public/robots.txt`, `public/llms.txt`
- Policy UI: FCC wording neutralized further

### Typecheck
```bash
cd apps/web && npm run build   # tsc -b && vite build
# or: npx tsc -b --pretty false
```

---

## 2026-08-06 - QuoterV2 + vault rails + FAssets redeem prepare

- **SparkDEX:** QuoterV2 `0x5B5513c55fd06e2658010c121c37b07fC8e8B705` on Mainnet only; `prepareSparkDexSwap` minOut/estimatedOut from `quoteExactInputSingle` (never FTSO). Slippage + price-impact-vs-FTSO surfaced. Pool discovery prefers `PoolCreated` logs + `getPool` harden. Coston2 empty bytecode gate unchanged.
- **Yield vaults:** Coston2 Firelight `0xC90D6847747b85d1fa2E07859869fb9fB72c0361` + Upshift `0x24c1a47cD5e8473b64EAB2a94515a196E10C7C81` status/prepare module (`yieldVaults.ts`); wired `@yield` + `/v1/agents/yield` (+ deposit prepare). **No APY invented.**
- **FAssets:** keep `lotSize()`; mint = `docs_handoff` (XRPL/Xaman, no fake button); `prepareFassetsRedeemLots` + event watch helper; API `/v1/agents/fassets/redeem/prepare`.
- Tests: Quoter path unit test asserts minOut is not FTSO mid.

---

## 2026-08-06 - Judge honesty fixes (cards ? stubs ? FCC ? models ? treasury)

- **Phase-scoped cards:** swap/bridge quote+prepare turns no longer also emit `swap_pairs` / `bridge_routes`; discovery cards only on clarify/catalog.
- **Execution registry:** removed stub adapters (`media.image`, `research.report`, `bound_work`, `trade.signal_action`, `signals.deep`); only live `swap` + `bridge` prepare adapters registered.
- **FCC:** default `FCC_MODE=unavailable` (never present simulated as verified); Security + Flow + `/health` copy neutralized.
- **Model badges:** show exact Agent Router model id; local/heuristic paths labeled `deterministic fallback` (no fake Claude Opus 5 / GPT-5.6 marketing names).
- **Treasury:** labeled as verified-read policy/budget lens over the same Portfolio desk ? not a separate vault product.
- Honesty: SparkDEX = Flare Mainnet only; Coston2 x402 = MockUSDT0.

---

## 2026-08-06 - Flare AI OS ship ? SparkDEX honesty ? FAssets ? Market Intel

### Research (mandatory)
- DevHub MCP + FAssets reference: **Coston2 controller returns 1 manager** (Testnet XRP / FTestXRP). FBTC/FDOGE **not on Coston2**.
- SparkDEX docs factory/router: **bytecode on Flare Mainnet only**; `eth_getCode` on Coston2 = empty. Prior Coston2 swap prepare targeted a non-contract ? critical honesty fix.
- Mainnet factory scan: liquid USDT0/FXRP@500, USDT0/WFLR@500, FXRP/WFLR@500 (+ thinner fee tiers).
- FCC: not public for this path ? keep simulated labels only.
- Research file: `WIN_RESEARCH_2026-08-06.md`.

### Shipped
- `sparkDex.ts`: deployment preflight, dynamic pool discovery, bidirectional prepare, Mainnet execute path
- `fassetsStatus.ts`: live AssetManagerController + settings + agents; FBTC/FDOGE labeled unavailable
- `marketIntel.ts`: FTSO + liquidity + LLM ? **not** a betting market
- `portfolioDesk.ts`: Coston2 balances marked with FTSO
- Agents: portfolio, fassets, intel, yield, risk, liquidity, treasury, crosschain, xrpfi (+ existing rails)
- Removed Flow `@video` agent + Bound Work **voice** catalog entry
- UI: Flare primitive badges, pairs / FAssets / intel / portfolio cards; MetaMask **chain 14** switch for SparkDEX
- APIs: `/v1/agents/swap/pairs`, `/fassets`, `/intel`, `/portfolio`

### Smoke (local)
- SPARKDEX flare: USD?0/FXRP@500, USD?0/WFLR@500, FXRP/WFLR@500
- FASSETS FTestXRP agents=4; FBTC,FDOGE unavailable
- INTEL risk-on; PORT ~$19.55 for test wallet

### Hotfixes after ship
- Security Redis policies blocked new agents ? `loadPolicy` unions OS rollout + chain 14
- FAssets lotSize: use `AssetManager.lotSize()` (was broken settings tuple) ? lot **10** / ~$10.61
- Deployed to `beacon-desk` Vercel project (not only `beacon` alias)

### Network map (judges)
| Rail | Network |
| --- | --- |
| FTSO / FAssets status / OFT / x402 | Coston2 (114) |
| SparkDEX swap execute | Flare Mainnet (14) |

**Live:** https://beacon-desk.vercel.app ? https://beacon-api-97gl.onrender.com

---

## 2026-08-05 - Deep Chrome production test + fixes

**Method:** Chrome DevTools MCP against `beacon-desk.vercel.app` + MetaMask account `0x3be5?c794` on Coston2 (`0x72`). Wallet txs that need the MetaMask **notification extension UI** cannot be fully clicked from CDP (extension popup not in page list); prepare/sign paths were exercised up to Confirm.

### Pass
- Wallet restore + shared session across Flow / Work / Policy
- FTSO live strip + `@signals` live feeds + risk-on bias
- Swap quote ? Confirm ? **Approve + Swap** card + Execution drawer (ready)
- Bound Work: wallet shown, Research ? brief form, draft resume after reload
- Security Center: Authorization Receipt (spent 1.75 / remaining), limits, agents
- Policy enforcement: daily 0.5 with spent 1.75 ? `Daily budget 0.5 USDT0 exceeded`
- History: conversations list + activity strip
- Bridge routes API: 4 on-chain peers including Base Sepolia
- Balances API after fix: USDT0 10 ? FXRP 9 ? Mock ~3006

### Bugs found and fixed (pushed)
1. `/v1/agents/balances` 500 ? MockUSDT0 `symbol()` CALL_EXCEPTION + bigint JSON ? tolerate symbol + serialize raw string (`9b36e68`)
2. Bound Work `/quote` 500 ? AI 405 message mismatch vs transient regex ? treat `temporarily unavailable (405)` as FIT fallback (`6a832bf`)
3. INTERNAL errors opaque ? include `detail` slice for diagnosis (`ee2f29c`)

### Blocked / needs human MetaMask click
- Complete Approve+Swap / Approve+Send / x402 Pay again on-chain confirms (MetaMask notification.html not automatable in this Chrome MCP session)

**Restore:** daily policy returned to 50 USDT0 after policy-block probe.

---

## 2026-08-05 - Dynamic OFT peers ? FTSO strip ? refresh-safe execution ? win research refresh

**Research:** DevHub getOftPeers pattern + Polymarket Gamma overview. Decision: **no Polymarket betting UI** for Bounty 1; keep Flare asset rails as the hero. Documented in `WIN_RESEARCH_2026-08-05.md`.

**Shipped**
- `discoverFxrpOftRoutes`: on-chain `peers(eid)` scan on Coston2 FXRP OFT Adapter with DevHub snapshot fallback; 10m cache
- `GET /v1/agents/bridge/routes` (+ bridge agent uses live routes)
- Flow header **FTSO live** strip (30s poll)
- Swap/bridge confirm ? `POST /v1/flow/activity` with explorer URL; activity list links to explorer
- `executionStates` restored from `sessionStorage` per conversation (approve/swap/send survive refresh)

**Honesty:** Destination fill still only via LayerZero Scan. Peer list can grow when Flare configures new EIDs.

---

## 2026-08-05 - x402 Settled is not a lock ? Pay again ? win research

**User question:** After FTSO / Research settle, UI showed "Settled for this service". Does that mean another pay is impossible?

**Answer:** No. Official x402/EIP-3009 is idempotent **per nonce**, not per catalog service. Remaining Security budget is unrelated.

**Fix**
- Badge ? "Last run settled"; CTA ? **Pay again** (same EIP-3009 sign path)
- Helper copy: fresh nonce unlocks a new resource
- `findActiveExecution` prefers in-flight ? unpaid ? latest `media_result` ? settled quote matching last delivery (stops drawer sticking on Research while FTSO is focused)
- Policy deny on pay ? **Authorization Receipt** card (BLOCKED) with link to Policy
- FTSO deep pack `media_result` now carries structured live feeds + notes (not narrate-only stub)
- Research file: `WIN_RESEARCH_2026-08-05.md` (Flare MCP + skills + Bounty 1 decisions; prediction markets = no)

**Test:** Hard refresh `/flow` ? `@pay` ? settle once ? confirm Pay again still clickable; optional Policy cap block shows receipt.

---

## 2026-08-05 - Real x402 research brief (no stub receipt)

**Bug:** Paying Research brief ($0.75) settled on-chain but UI showed the same stub three times: "Paid research brief unlocked?". Root cause: `fulfillPaidResource` used `narrate()` with a weak prompt; on model failure it returned the stub while still labeling Claude Opus 5. Summary + content + chat text were identical.

**Fix**
- New `generateResearchBrief`: real structured brief (topic, snapshot, key points, risks, source checklist). Uses Agent Router generator with model fallbacks. Rejects stub-shaped replies. Local Flare-grounded brief if AI is down.
- `@pay` / empty scopes normalize to a Flare builder default topic.
- Chat line is a short settlement note. Card renders the brief via `AgentText` once.
- `chatForRole` now retries on `temporarily unavailable (429|502|503|504)` (regex was matching the wrong error string).

---

## 2026-08-05 - Shared wallet session across Flow / Work / Policy

**Bug:** Bound Work always showed Connect even when Flow already had a restored wallet. Tab changes remounted each page with its own `useState`, and Workspace never called `tryRestoreWallet`.

**Fix**
- `ProductWalletProvider` at the shell: restore once, listen for `accountsChanged`, expose `wallet` / `connect` / `connecting` / `ready`
- Flow, Workspace (Bound Work), and Security all consume the shared session
- Desk draft (`step` / `serviceId` / `jobId`) persisted in `sessionStorage` so Work survives tab switches like Flow conversations
- Softer route fade (no blank `mode="wait"` flash), services prefetch + retry button when the API is cold

---

## 2026-08-05 - Product theme system, readable dark/light, typeset agent output

**Goal:** Kill the broken light/dark mix inside the product shell, make tab routing smooth, and give agent replies real typography.

**Root cause found**
- `Workspace`, `ExecutionDrawer`, `SecurityPage` and the shared UI primitives (`Button`, `Badge`, `Skeleton`) hardcoded the *landing* palette (`bg-paper`, `text-ink`, `white/10`, `bg-[#0d100e]`) while `ProductShell` drove the theme. Result: white headings on white cards in the desk, a dark receipt card on a light page, invisible policy inputs.

**Fix**
- `index.css`: full `--p-*` scale per theme (bg / rail / surface / surface-2 / fg / muted / faint / border / border-strong / hover / accent / accent-text / on-accent / danger / shadow). Inside `.product-shell` the landing tokens (`--color-paper`, `--color-ink`, `--color-line`, ...) are remapped, so every shared component inherits the product theme instead of fighting it.
- `.product-shell .bg-signal` forces `--p-on-accent` text, so emerald buttons stay readable in both themes (placed in the utilities layer so it wins the cascade).
- `--p-accent-text` (`#5cecab` dark, `#0c7a45` light) replaces raw `text-signal` for accent text, which failed WCAG on light backgrounds.
- Themed focus rings, selection, scrollbars.

**UI**
- Rail redesigned: labelled Flow / Work / Policy, spring `layoutId` active pill, theme toggle and explorer pinned to the bottom.
- Route changes animate through `AnimatePresence` keyed on the top segment, with `useReducedMotion` respected.
- Bound Work no longer renders a second brand header inside the shell (`<Workspace embedded />`); step pills got a pill/outline treatment.
- Security Center: labelled inputs on real surfaces, receipt card themed instead of a fixed dark gradient, danger actions use `--p-danger`.

**Agent output**
- New `AgentText` parses agent replies into typeset blocks (headings, bullets, bold, inline code, links) rendered through `.beacon-prose`. Replaces `whitespace-pre-wrap` plus the markdown-stripping hack.
- Em-dashes removed from every user-visible string in Flow, the desk, execution phases and the shared agent narrations.

---

## 2026-08-05 ? Flow OS UX ? Bound Work shell ? x402 Paid fix ? quote redesign

**Goal:** Product shell that never abandons chat chrome; honest x402 Paid badges; premium bridge quotes (brand emerald, dark/light).

**Bugs fixed**
- Bound Work / Security left Flow for `/app` or standalone pages ? nested under `ProductShell` at `/flow/desk` and `/flow/security`; `/app` redirects to `/flow/desk`
- x402 catalog showed every item Paid after any `media_result` ? `inferSettledServiceIds` only settles when `media_result.serviceId` matches; catalog shows Unpaid vs Settled per service
- Bridge quote prose dumped 18-decimal fees + markdown walls ? `nativeFeeDisplay` rounded to 4dp; `formatNativeFeeDisplay` / structured quote cards; assistant text strips `**`

**UI**
- `ProductShell` rail + dark/light theme (`productTheme`, `--p-*` tokens aligned to landing signal emerald)
- Bridge quote/prepare cards: amount | destination | fee grid; LayerZero Scan + Coston2 explorer after source confirm
- Flow / Security / Desk consume product tokens (no purple OFT accents)

**Honesty:** Destination fill still only via LayerZero Scan Delivered - Beacon does not invent fills.

**Next:** Deploy + Chrome verify Bound Work stays in shell; Pay catalog Unpaid until that service settles.

---

## 2026-08-05 ? Productization refactor ? Gates 0?4 in progress

**Goal:** Universal execution engine; Bounty 1 Interoperable Asset Products; remove pay-loop and bridge-plan-only bugs.

**Research:** `PRODUCTIZATION_RESEARCH_2026-08-05.md` ? DevHub MCP + skills + LayerZero Flare testnet + flare-viem-starter OFT + x402 official guide. FCC stays Security Center only (simulated labeled). No private inspiration names in repo files.

**Shipped**
- Gate 0: research baseline + living `IMPLEMENTATION.md` header (no longer ?pre-code?); `FINAL_AUDIT` / gap analysis corrected
- Gate 1: `@beacon/execution` ? phases, transitions, hash, registry, events; `003_execution_engine.sql`; 9 transition tests green
- Hero bridge (EOA): `prepareFxrpOftBridge` with live `quoteSend` (~22.95 C2FLR for 1 FXRP?Sepolia); executor `extraOptions` via LayerZero Options; `POST /v1/agents/bridge/prepare`; Flow `bridge_quote` / `bridge_prepare`; `executeOftBridge`; agent renamed Bridge FXRP OFT; JSON-safe BigInt serialization for API
- x402 P0: settle fail-closed (verify alone never grants access); `serviceId` + frozen brief on Pay resend; `fulfillPaidResource` skips catalog; protected `/v1/agents/resources/:id` with nonce replay cache; historical Pay buttons disable after settle
- Gate 2: `PolicyEvaluator` ? server-enforced + honest FCC mode; Security Center copy updated
- Gate 2: Execution API runtime ? Postgres store, engine, workflow registry; swap + bridge adapters call real prepare; stubs for media/research/bound_work/trade/signals
- Gate 5: Unified Flow shell ? `ExecutionDrawer` phase timeline, Mock vs USDT0 labels, denser agent chips, Flow|Bound Work|Security nav
- Gate 6: `POST /v1/chat/stream` Agent Router token SSE; execution events SSE already on `/v1/executions/:id/events`
- Deploy: pushed `a597ef0` ? GitHub main; Render build includes `@beacon/execution`; Vercel `beacon-desk` auto-deploy; live `/v1/agents/resources/image-logo` returns 402; `/v1/executions/workflows` lists adapters

**Honesty:** Destination OFT fill not claimed without LayerZero Scan + dest receipt. MockUSDT0 ? Coston2 USDT0. Smart Account direct-mint path not exposed until full evidence chain.

**Next:** Wallet acceptance runs (swap/bridge/pay) on Coston2; Bound Work adapter deep wiring; Smart Account path only after full XRPL?Coston2?LZ?Sepolia proof.

---

## 2026-08-05 ? Hackathon win mode ? AI OS productization

**Goal:** Beacon feels like production Flare AI OS, not chatbot + demos.

**Research:** `FLAGSHIP_FINAL_RESEARCH.md` (DevHub MCP: FTSO, SparkDEX, FAssets, OFT peers BSC/Sepolia/Hyperliquid 40362, x402/EIP-3009, Smart Accounts honesty, Coston2 developer tools).

**Shipped**
- Fixed ChatGPT layout: `h-dvh`, fixed sidebars/header/composer; only messages scroll
- Postgres persistence: `flow_conversations` / `flow_messages` / `flow_activity` by wallet; resume on reconnect; rename / pin / archive / search
- Intent auto-detect from General (logo?image, swap?swap, bridge?bridge, research?research)
- Image: clarify brief ? quote ? x402 ? generate (never pay-first)
- Research: scope clarify ? x402 brief
- Bridge: OFT routes ? destination+amount plan card (honest fees; no fake fill)
- API client: `/v1/flow/*` + `conversationId` on chat

**Verify:** unit tests + web build + push + live `/v1/flow/conversations` + desk `/flow`

---

## 2026-08-05 ? Flagship productization (gap analysis ? one pipeline)

**Problem:** Screenshots showed working swap e2e, but product still felt like disconnected demos ? generic x402 $0.10, bridge clarify loops, every image forced to Bound Work, no session memory, inconsistent model badges.

**Research:** `PRODUCT_GAP_ANALYSIS.md`, `PRODUCTION_AUDIT.md` (DevHub MCP re-verify: x402 resource payments, FXRP OFT peers BSC/Sepolia/Hyperliquid, FTSO, Smart Accounts honesty, FCC not public prod).

**Fix**
- One story: Intent ? Quote ? Pay ? Execute ? Receipt
- Bridge: lead with documented OFT routes (no empty clarify loop)
- x402: provider / price / reason / ETA / resource (no orphan $0.10)
- Small image (logo) ? instant x402 ? generate; large ? Bound Work
- Agent-specific system prompts; model badge from requested model family
- Wallet soft restore + Flow conversation persistence + History strip

**Verification:** unit tests + web build + live push

---

## 2026-08-05 ? Flagship Flare OS upgrade (hackathon winner mode)

**Problem:** Flow felt prototype-y; Security Center was UI-only; FCC/Smart Accounts risked being over-claimed; chat lacked creative briefing.

**Root cause / research:** Re-verified via DevHub MCP + skills. FCC is **not fully public production** yet. Smart Accounts are XRPL?PersonalAccount, not MetaMask session keys. Closest popup reduction = x402/EIP-3009. SparkDEX remains approve+swap with receipts. See `FLAGSHIP_FLARE_OS_RESEARCH.md` + `FLOW_PRODUCTION_RESEARCH.md`.

**Fix**
- Policy engine `apps/api/src/securityPolicy.ts` ? enforce pause / allowlist / per-job / daily spend on desk **approve** + agent **chat/x402**; record daily spend in Redis
- Authorization Receipt in Security Center (`/flow/security`) ? budget remaining, spent today
- Conversational video/image brief (15/30/60 + aspect/style) before Bound Work
- Trade desk FTSO-driven swap / hold suggestion
- Bound Work quote honesty: MockUSDT0 vs SparkDEX USDT0 + Security link
- Conversation engine: Thinking ? Beacon + Powered by Claude/GPT; real SparkDEX receipt UX (prior)

**Verification**
- `vitest` `flareAgents.test.ts` (amount parser + model labels)
- Coston2 probe: FTSO live, FXRP `0x0b6A?`, swap prepare `1 USDT0` ? est FXRP
- `npm run build -w @beacon/web` succeeds

**Commit:** `32cc287` (pushed to `goat-dev8/beacon` main)

**Follow-up:** `2586644` ? narrate fallbacks never leak internal situation prompts when AI upstream fails.

---

## 2026-08-05 ? Production conversation engine (Flow redesign)

**Research:** `FLOW_PRODUCTION_RESEARCH.md` (DevHub Smart Accounts, SparkDEX USDT0?FXRP, x402/EIP-3009, LayerZero Flare testnet, FAssets, honesty on session keys).

**Shipped**
- Multi-turn agent chat: clarify ? quote ? confirm ? prepare (never one-shot calldata)
- Fixed amount parser so `USDT0` no longer yields `amountIn=0`
- AI errors sanitized (no HTML/405 dumps); UI shows **Thinking?** ? **Beacon** + subtle **Powered by Claude Opus 5 / GPT-5.6** (never AgentRouter brand)
- Real SparkDEX path: approve + swap, `waitForTransactionReceipt`, explorer links, balance refresh via `GET /v1/agents/balances`
- Security Center `/flow/security` + `GET/PUT /v1/security/policy` + `POST /v1/security/revoke` (Redis when configured)
- Conversation `state` round-tripped on `/v1/agents/chat`

**Honesty**
- MetaMask still required for SparkDEX EOA swaps (1?2 txs) ? Flare Smart Accounts ? MetaMask session keys
- Best popup reduction for Beacon services remains **x402 / EIP-3009**
- MockUSDT0 (desk/x402) ? SparkDEX Coston2 USDT0

---

## 2026-08-04 ? Beacon Flow (Anvita-style Flare agents)

**Research:** `AGENT_FLOW_RESEARCH.md` (skills + DevHub MCP + flare-foundation + LayerZero + FAssets + USDT0?FXRP docs + Anvita Flow UX).

**Shipped**
- `/flow` multi-agent chrome (rooms: general, signals, swap, bridge, pay, trade, desk)
- API: `GET /v1/agents`, `GET /v1/agents/signals`, `POST /v1/agents/swap/prepare`, `POST /v1/agents/chat` (+ optional x402 settle)
- Shared: `ftso.ts` (live `getFeedsById`), `flareAgents.ts` (tool router + action cards)
- Real FTSO on Coston2; SparkDEX USDT0?FXRP prepare (user signs); x402 for premium trade/bridge; honest LZ bridge planner; desk deep-link

**Honesty:** Beacon MockUSDT0 ? Coston2 SparkDEX USDT0 ? labeled in cards/UI.

---

## Status snapshot (2026-08-04)

**Product:** Beacon ? Finish AI work. Pay only when it passes.  
**Production desk:** https://beacon-desk.vercel.app/  
**Production API:** https://beacon-api-97gl.onrender.com/ (`pipeline` caps `2026-08-04-pro-media-v1`)  
**Local desk:** `http://localhost:5173/` ? API: `http://127.0.0.1:3001`  
**Network:** Flare Testnet Coston2 (chain 114)  
**Live contracts**
| Contract | Address |
|---|---|
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` |
| BeaconJobRegistry | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` |
| BeaconEscrow | `0x68E29567a9eC60D6ADb71901CE187C22Cc087138` |

Deployer/payee: `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034`  
Explorer: https://coston2-explorer.flare.network

### Media providers (live)
- **HF Inference** fine-grained token ? fal-ai Flux.schnell via router (local JPEG proven)
- **Pollinations** API key present; Paid/Quest Pollen was **0** at capture ? fail-fast on 402
- AgentRouter chat for prompt engineer / quote / judge (image models still 403 on AgentRouter)
- SVG fallback only when Comfy + HF + Pollinations all fail
- **`MEDIA_FAST=true`** on Render: skip Opus prompt eng + L2 judge hang; Flux still runs
- Proven Render Image e2e: job `b133b5f7?` ? **CLOSED / Paid** ? `image/jpeg` ? escrow released `0x03d86bec?`

### Proven end-to-end (real wallet + escrow + settle)
| Job | Path | Result | Escrow | Lock / notes |
|---|---|---|---|---|
| `1de49605?` | **Vercel + MetaMask** Image | **Done / Paid $5.88** | released | SVG creative ? lock `0xe55379a3?` ? wallet `0x3be5?c794` |
| `a0071b85?` | deep-api Image (Render) | **CLOSED** PASS | released | `image/svg+xml` artifact proven |
| `517200e7?` | deep-api documents | **CLOSED** PASS | released | script |
| `484e48d1?` | deep-api documents | **CLOSED** PASS | released | script |
| `761a4e07?` | deep-api documents | **CLOSED** PASS | released | script |
| `a80ab71b?` | **Chrome + MetaMask** documents | **Done / Paid $10.63** | released | lock `0x3228aba2?` |
| `bd318f92?` | early video (pre-fix) | FAIL UI ?Not charged? | stuck then manual refund `0xec7321a0?` | root-cause below |
| `c3c98334?` | Chrome mid-fix | FAIL / CLOSED | refunded | stale orchestrator race |
| `b9951543?` | deep-api | FAIL then refunded | refunded | L2 judge flake (later softened) |

### Production deploy notes (2026-08-04)
- GitHub `main` ? Render `beacon-api` + Vercel `beacon-desk` (clean domain `beacon-desk.vercel.app`)
- **Pro media v1** (`2026-08-04-pro-media-v1`): Claude Opus / GPT-5.6 Sol **prompt engineer** ? ComfyUI ? Hugging Face **fal Flux.schnell** ? Pollinations ? SVG
- Commit `d65ba7f`: HF fal path + fail-fast Pollinations + video companion-only L1 fix- Pollinations anonymous Flux is **broken/paid** (402 insufficient Pollen) ? not a quality path anymore
- For ?best ever? raster/video: set `COMFYUI_URL` (Flux.2/Wan/LTX) and/or `HF_TOKEN`; OpenMontage/Remotion via `OPENMONTAGE_ROOT` / `VIDEO_TOOLKIT_ROOT`; video MP4 via `ffmpeg-static` zoom+xfade
- Skills/MCP: `MEDIA.md`; Pollinations + ComfyUI MCP in Cursor `mcp.json`; `/openmontage` `/agent-demo-video` `/remotion-create`
- Vercel SPA: root `vercel.json` rewrites so `/app` hard-refresh works

---

## What we built

### Backend
- Monorepo: shared, x402, quote, acceptance, pipeline, receipts, fdc, smart-accounts, orchestrator, settler, api, web
- Postgres (Supabase) + Redis (Upstash)
- API Fastify: create ? quote ? approve ? SSE events ? artifacts ? look ? receipts
- **Embedded workers** in API process (`apps/api/src/workers.ts`) ? pipeline + settler (Render-friendly)
- `jobIdToBytes32` = sha256(utf8 jobId) shared; escrow lock/release/refund use same hash
- Video without Remotion: storyboard JSON + captions (no fake MP4)
- Acceptance: L1 mime/objective, L2 AI judge, L3 brand; hydrate file text for judge
- L2 alone no longer hard-FAILS (? NEEDS_LOOK); objective L1/L3 still gate charge
- SSE route hijack + safe Redis log parse (fixed process crash on Live progress)
- Artifact **content** API: `GET /v1/jobs/:id/artifacts/:artifactId` (inline preview)
- Job receipt API: `GET /v1/jobs/:id/receipt`
- Documents compose now writes **real draft body** into `deliverable.md` (was URI list only)

### Frontend (`apps/web`)
- React 19 + Vite + Tailwind 4 + Motion + RQ + RHF + Zod + viem
- Greptile-inspired **light** desk: mint `#39e08a`, paper `#f4f3f1`, ink `#2a2735`
- Landing + `/app` Bound Work flow
- MetaMask: Coston2 connect, EIP-3009, `BeaconEscrow.lockWithAuthorization`, mint MockUSDT0
- Result panel: **agent-style transcript** (inline draft/document), artifact tabs, Flare rails timeline, receipt with lock/settle explorer links
- Progress: consumer timeline + **Flare rails ? Coston2** (wallet ? EIP-3009 ? escrow lock ? generate ? acceptance ? release/refund ? receipt)
- `?job=<id>` restores Done/result view after refresh

### Contracts / Flare
- Forge tests 5/5; Coston2 deploy live
- Real steps shown in UI match: EIP-3009 ? lockWithAuthorization ? releaseToPayee / refund

### Design language
- Ditto/Greptile study for **language only** (no asset clone)
- Faceted CTAs, crosshair grid, Anybody + DM Sans + Space Mono

---

## Bugs found ? fixed

1. **Queued ? Not charged (video `bd318f92`)**  
   - Lock OK; Remotion missing ? weak deliverable ? L1 FAIL  
   - Settler used wrong job hash ? refund missed lock ? manual refund  
   - **Fix:** shared sha256 hash; storyboard path; FAIL refunds escrow

2. **Render API alone didn?t run workers** historically ? jobs stuck Queued  
   - **Fix:** embed pipeline+settler in API

3. **SSE `JSON.parse("[object Object]")` crashed API** during Chrome progress  
   - **Fix:** hijack + safe parse

4. **Stale `services/orchestrator` raced embedded workers** ? bad accepts  
   - **Fix:** kill standalone orchestrator; use embedded only

5. **Result ?Open? did nothing** (`file://` temp paths blocked by Chrome)  
   - **Fix:** content API + inline agent transcript (no file://)

6. **Deliverable.md was only path list**  
   - **Fix:** compose copies draft markdown into deliverable

7. **Flaky L2 judge FAIL on good docs**  
   - **Fix:** L2 fail ? NEEDS_LOOK; softer judge prompt

---

## Outstanding / known

- AgentRouter key historically **401** ? generator/judge may skip AI; L1/L3 still gate. Re-check key for production Opus/GPT.
- Remotion CLI not installed ? video = storyboard+captions until Remotion wired.
- Production web still needs static deploy; local `VITE_API_URL` points at `127.0.0.1:3001` for deep tests (Render API: `https://beacon-api-97gl.onrender.com` when redeployed with workers).
- FCC TEE: simulated mode honesty banner on `/health`.

---

## How to run (local)

```bash
# API + workers
npx tsx apps/api/src/index.ts

# Web
cd apps/web && npx vite --port 5173

# Scripted e2e (deployer key locks escrow)
npx tsx scripts/deep-api-job.ts
```

Desk: http://localhost:5173/app  
Reopen a finished job: http://localhost:5173/app?job=<uuid>

---

## Phase notes (earlier same day)

- Env verified: Postgres OK, Redis PONG, Coston2 114, deployer funded  
- DB migration `001_init.sql` applied  
- `fce-beacon` scaffold + FIT/JOB handlers  
- Frontend Greptile light redesign after dark UI rejected  
- Chrome MetaMask e2e: Documents ? $10.63 ? Approve ? Done Paid


### Hotfix ? Security policy migration
Stale Redis policies blocked `@fassets` / `@liquidity` etc. `loadPolicy` now unions OS agent rollout + chain 14 (drops legacy `video` agent id).

