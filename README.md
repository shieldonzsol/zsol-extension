# zSol for Chrome

Lightning-fast privacy on a click, for Solana traders.

zSol's private wallet opens in your browser's side panel, or as an overlay on the trading
terminals you already use (Axiom, GMGN, Terminal and more). Go dark, send, pay many and trade
from ghost wallets without leaving your chart. Built on Helius Privacy Rings.

> **Status: early development.** The extension is not in the Chrome Web Store yet, and it does
> not hold a wallet yet. Until it does, zSol runs at [zsol.cc](https://zsol.cc).

## What it will do

- Open zSol in Chrome's side panel from the toolbar, and keep it there across tabs.
- Put zSol over a trading terminal, only on the sites where you turn it on.
- Show your private balance and trade, send and pay from it with one click.
- Connect to your zSol account with a one-time code from zsol.cc.

## Principles

- **Your keys stay on your device.** The panel signs on your machine; nothing it holds is sent
  to us in the clear.
- **The fewest permissions possible.** Today the extension asks Chrome for one: the side panel.
  The overlay will ask for a site only when you turn it on there. Every permission the extension
  adds is explained in its pull request.
- **No code from the network.** Everything the extension runs ships inside the package.
- **No tracking.** The extension sends no analytics and no error reports.

## Develop

Needs Node 22.12 or newer (CI uses the version in `.node-version`) and pnpm (the version in
`package.json`, which Corepack or pnpm itself picks up).

```sh
pnpm install
pnpm dev
```

`pnpm dev` builds into `.output/chrome-mv3-dev` and rebuilds on change. Load that folder in
Chrome: open `chrome://extensions`, turn on Developer mode, press **Load unpacked**, then press
the zSol button in the toolbar.

```sh
pnpm check         # types, lint, tests and formatting
pnpm build         # production build in .output/chrome-mv3
pnpm check:build   # checks the build: permissions, policy, no remote code, no machine paths
```

Built with [WXT](https://wxt.dev), React, Tailwind CSS and TypeScript.

## Security

Please report a vulnerability privately: see [SECURITY.md](SECURITY.md). The only official
releases are the ones linked from [zsol.cc](https://zsol.cc).

## License

The code is under the [MIT License](LICENSE). The zSol name and logo are trademarks of zSol and
are not covered by the license: a fork must use its own name and logo.
