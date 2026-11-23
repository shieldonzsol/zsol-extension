# AGENTS.md

Rules for anyone, person or coding agent, who changes this repository.

1. **Commit identity.** Every commit is authored and committed as `zSol`
   `<360375145+shieldonzsol@users.noreply.github.com>`, set in this clone's own git config. Check
   `git log -1 --format='%an <%ae> | %cn <%ce> | %ad'` before pushing. Never commit under another
   name or address, and add no co-author or tool trailers. Commit with `TZ=UTC` so a commit
   carries no local time zone.
2. **Nothing private in public.** No absolute paths from a machine, no personal names or email
   addresses, no names of other projects or internal tools, in files, commit messages, pull
   requests or issues.
3. **Permissions are deliberate.** A new permission, host, content script or
   `externally_connectable` entry changes `src/manifest.ts`, `tests/manifest.test.ts` and
   `scripts/check-build.mjs` together, with the reason in the pull request.
4. **No remote code.** Everything the extension runs ships in the package. Data fetched at
   runtime never decides which code runs.
5. **Dependencies.** Exact versions, each release at least 7 days old; a package with an install
   script is listed in `pnpm-workspace.yaml`. Follow each tool's official docs.
6. **Before a commit:** `pnpm check`, `pnpm build` and `pnpm check:build` pass. Browsers in tests
   run headless.
7. **Words.** Plain English in the panel and in docs: what happens, to whom, with numbers. No em
   dashes.
8. **Comments, strict.** Minimal: only a reason the code can't show by itself. Never name or
   point to a document, plan, ticket, decision, internal file or private project in a comment,
   commit message or pull request. Code that needs a paragraph to explain needs better names.
