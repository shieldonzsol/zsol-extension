import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { defineConfig } from "wxt";

import { manifestFor } from "./src/manifest";

const CAPTCHA_STUB = fileURLToPath(new URL("./src/stubs/empty-captcha.ts", import.meta.url));

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ mode }) => manifestFor(mode),
  srcDir: "src",
  publicDir: "public",
  imports: false,
  // Load .output/chrome-mv3-dev in your own browser.
  webExt: { disabled: true },
  vite: () => ({
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
    resolve: {
      alias: [
        // Privy's CAPTCHA widgets load scripts from the network; CAPTCHA is off for this app.
        { find: "@marsidev/react-turnstile", replacement: CAPTCHA_STUB },
        { find: "@hcaptcha/react-hcaptcha", replacement: CAPTCHA_STUB },
        // The hasher's slim build loads its .wasm from the package instead of inlining it.
        { find: /^@lightprotocol\/hasher\.rs$/, replacement: "@lightprotocol/hasher.rs/slim" },
      ],
    },
  }),
});
