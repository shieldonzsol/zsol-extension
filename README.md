# zSol for Chrome

zSol in your browser's side panel: a private Solana wallet for traders, open beside every chart.

> **Status: early development.** The extension is not in the Chrome Web Store yet, and this
> panel does not hold a wallet yet. Until it does, zSol runs at [zsol.cc](https://zsol.cc).

## What it will do

- Open zSol in Chrome's side panel from the toolbar, and keep it there across tabs.
- Show your private balance and trade, send and pay from it in the panel.
- Connect to your zSol account with a one-time code from zsol.cc.

## Principles

- **Your keys stay on your device.** The panel signs on your machine; nothing it holds is sent
  to us in the clear.
- **The fewest permissions possible.** Today the extension asks Chrome for one: the side panel.
  Every permission it adds is explained in its pull request.
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
