# Contributing

Thanks for helping. A few rules keep a wallet extension safe:

- **Permissions:** a pull request that adds a permission, a host or a content script explains
  why the panel needs it. `tests/manifest.test.ts` and `pnpm check:build` fail until it does.
- **Dependencies:** exact versions only, each release at least 7 days old (pnpm enforces it).
  A package with an install script is named in `pnpm-workspace.yaml`, allowed or refused.
- **No remote code:** nothing loads a script from the network.
- **Checks:** `pnpm check`, `pnpm build` and `pnpm check:build` pass before a pull request.
- **Security bugs** go through [SECURITY.md](SECURITY.md), never a public issue.

By contributing you agree your work is released under the [MIT License](LICENSE).
