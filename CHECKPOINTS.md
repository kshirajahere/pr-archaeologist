# Stage checkpoints

During the initial build, the session policy mounted `.git` read-only. Stage 1's
`git add` and `git commit` both failed creating `.git/index.lock` (permission
denied). The checkpoints below preserve that initial build history. The current
workspace permits Git writes; the initial implementation is commit `440df68`.

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

## 2026-10-17 verification and review drafts

- Public repository created under `kshirajahere/pr-archaeologist`.
- Baseline: 31/31 tests passed. Added five draft tests, observed all five fail
  before implementation, then implemented `draft_review` and stale-draft checks.
- Final `npm test`: 36/36 passed, including production build, both TypeScript
  projects, stdio, HTTP, authentication, role scope, audit and widget DOM checks.
- `npm run demo`: eight tools complete the fixture flow, producing five cited
  draft comments and a readonly dry run. No live GitHub review was published.
- Real GitHub MCP smoke check on a separate pull request: all eight
  tools, three project resources and the prompt passed. Line provenance returned
  a real introduction commit; no supported recurring rules were found. Posting
  remained a readonly dry run. Temporary credentials were kept in process memory.
- Chrome visual inspection: fixture preview at desktop and 390-pixel mobile
  widths, four findings and original source links. Screenshots and test output
  are in local ignored `logs/`.
- NitroCloud reached its sign-in screen. NitroStudio GUI and a deployed remote
  MCP endpoint remain unverified. The guide-based remaining work is in
  `BUILDATHON.md`.

## MCP follow-up review expansion

- Added `read_pr_file`, `pr_discussion`, `pr_changes_since`, `recheck_findings`
  and the `review-pr-update` prompt. Discovery now returns twelve tools.
- Added eight focused follow-up tests plus stdio/HTTP coverage. The new test
  file first failed because the service did not exist. Current workspace
  `npm test`: 52/52 passed, including the production build and widget checks.
- `npm run demo` exercises all twelve tools: PR-head file content, current
  discussion, an incremental fixture diff, four saved findings still detected,
  cited draft, readonly dry run and denied secret access.
- Live MCP on that same pull request: all twelve tools, three
  resources and both prompts passed. A parent-to-head comparison returned the
  actual changed test file; reading it used the same pinned head. No live
  GitHub review was posted. Empty live findings are integration evidence only.
- Missing patches, redacted code, the 300-file comparison cap and diverged
  history have explicit outcomes. A missing finding is not claimed to be fixed;
  REST discussion reads do not claim resolved-thread state.
- Pre-existing uncommitted core, security and widget changes were preserved.
