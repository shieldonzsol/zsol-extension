// Checks the built extension before it is packed or published:
// - the manifest asks for nothing beyond what src/manifest.ts declares,
// - the content security policy keeps scripts to the package itself,
// - no file loads a script from anywhere else (Chrome's store bans remote code),
// - no file carries a path from the machine that built it.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".output/chrome-mv3");
const problems = [];

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

const allowedPermissions = new Set(["sidePanel"]);
for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.has(permission)) problems.push(`manifest asks for "${permission}"`);
}
for (const key of ["host_permissions", "optional_host_permissions", "content_scripts"]) {
  if (manifest[key]?.length) problems.push(`manifest has ${key}`);
}
if (manifest.externally_connectable) problems.push("manifest has externally_connectable");

const policy = manifest.content_security_policy?.extension_pages;
if (policy && !/script-src 'self'( 'wasm-unsafe-eval')?;/.test(policy)) {
  problems.push(`extension pages allow scripts beyond the package: ${policy}`);
}

const remoteScript =
  /<script[^>]+src=["']https?:|importScripts\(\s*["']https?:|import\(\s*["']https?:/i;
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
  const found = text.match(machinePath);
  if (found) problems.push(`${name} carries a machine path: ${found[0]}`);
}

if (problems.length > 0) {
  console.error(`check-build: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("check-build: the manifest, the policy and every built file are clean");
