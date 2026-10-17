# Stage checkpoints

The session policy mounts the existing `.git` directory read-only. Stage 1's
`git add` and `git commit` both failed creating `.git/index.lock` (permission
denied). No commits or pushes have been made. Checkpoints below record verified
stages; the five requested commits remain blocked by that policy.

1. Scaffold, `pr_context`, `why_line`: `npm test` — 8/8 passed; TypeScript build
   passed; real stdio MCP discovery and both tool calls passed.
2. Rules and decision conflicts: `npm test` — 13/13 passed, after the five new
   tests first failed. Four recurring rules mined; four changed-line findings;
   the historical timeout fix is identified; clean PR and scope/cache isolation
   checks pass.
3. Authentication, RBAC, audit and posting: `npm test` — 22/22 passed; invalid
   credentials, forged roles/JWTs, denied repositories/paths, docs-only posting,
   readonly dry run, mock posting, invalid review lines, per-identity rate limits,
   audit redaction and audited cache hits checked. No live GitHub writes made.
4. Reviewers, resources, prompt and widget: checkpoint reached 27 passing tests across
   service, real stdio and real HTTP. Exported widget HTML and widget TypeScript
   compile. Browser automation is unavailable (CDP channel closes; no UI connector
   browsers), so visual/NitroStudio GUI verification remains unperformed.

   HTTP integration exposed NitroStack 1.1.2's positive-integer schema conversion
   issue (use equivalent `min(1)` constraints) and missing auth headers in resource
   contexts (carry the real request header with AsyncLocalStorage). HTTP tests
   verify readonly, docs-bot, unauthenticated and public widget-example boundaries.
5. README, Claude/Cursor configs, deployment instructions and 90-second demo:
   `npm test` — 31/31 passed, including concurrent HTTP role isolation, a desktop
   launch from a different directory, changed-head posting refusal and production
   widget DOM rendering/escaping. `npm run demo` passed the full asserted MCP flow.
   `npm run dev` reached Development Server Ready; GET /preview returned 200 with
   four rendered findings and source links. No visual browser or Studio GUI check.

   `nitrostack-cli pack --dry-run` and `npm run pack` succeeded. ZIP inspection
   confirmed source/config/fixtures/docs and .env.example are included; real .env,
   .git, logs, dependencies, build outputs, caches and temporary tooling excluded.
   Root and widget `npm audit --omit=dev` report zero vulnerabilities. The root
   CLI development dependency tree still reports four transitive advisories
   (braces/chokidar and esbuild); no runtime advisories were reported.

   Final widget checks wait for the SDK's mounted runtime and capture React
   console errors. jsdom lacks ResizeObserver, so the harness supplies the sizing
   API without claiming layout coverage. The two production DOM tests passed in
   15 consecutive runs after isolating that missing-API effect failure.

NitroStack 1.1.2 starts a referenced cleanup interval on import. Tests use Node's
`--test-force-exit --test-isolation=none` after completing assertions. MCP child
processes are explicitly closed.
