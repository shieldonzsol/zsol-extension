// Fails on new permissions, remote scripts, a loosened policy or machine paths in the build.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".output/chrome-mv3");
const problems = [];

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

const allowedPermissions = new Set(["sidePanel", "storage", "alarms", "idle", "activeTab"]);
for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.has(permission)) problems.push(`manifest asks for "${permission}"`);
}
for (const key of ["host_permissions", "optional_host_permissions", "content_scripts"]) {
  if (manifest[key]?.length) problems.push(`manifest has ${key}`);
}
const pages = manifest.externally_connectable?.matches ?? [];
if (manifest.externally_connectable?.ids || pages.join() !== "https://zsol.cc/*") {
  problems.push(
    `externally_connectable reaches beyond zsol.cc: ${JSON.stringify(manifest.externally_connectable)}`,
  );
}

const policy = manifest.content_security_policy?.extension_pages;
if (policy !== undefined && policy !== "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';") {
  problems.push(`extension pages allow scripts beyond the package: ${policy}`);
}

const remoteScript =
  /<script[^>]+src=["']https?:|importScripts\(\s*["']https?:|import\(\s*["']https?:/i;
// Hosts of scripts Privy's SDK can load (CAPTCHA, Telegram login), stubbed out at build time.
const remoteScriptHost = /challenges\.cloudflare\.com|js\.hcaptcha\.com|telegram\.org\/js/;
const machinePath = /\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Z]:\\Users\\|node_modules\/\.pnpm\//;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

for await (const file of files(root)) {
  if (!/\.(html|js|mjs|css|json|map)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  const name = path.relative(root, file);
  if (remoteScript.test(text)) problems.push(`${name} loads a script from the network`);
  const host = text.match(remoteScriptHost);
  if (host) problems.push(`${name} names a remote script host: ${host[0]}`);
  const found = text.match(machinePath);
  if (found) problems.push(`${name} carries a machine path: ${found[0]}`);
}

if (problems.length > 0) {
  console.error(`check-build: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("check-build: the manifest, the policy and every built file are clean");
