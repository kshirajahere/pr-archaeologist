# Buildathon priorities

Original product: **GitHub pull request review**. Track: **Developer Tools**.

The workflow improvement: a reviewer sees a small cleanup; an MCP client recovers
the earlier incident, review comments and recurring team rules, then prepares a
cited review before the change brings back the same bug.

The supplied guide emphasizes MCP centrality, clarity of improvement, demo
quality and reliable execution (section 7). Finish this narrow workflow before
adding more integrations.

| Priority | What to show | Evidence and remaining work |
| --- | --- | --- |
| MCP centrality | Discoverable tools coordinate PR patches, commit history, review threads, linked issues and team rules | stdio and HTTP integration checks; show actual tool calls using `review-like-a-senior` in NitroStudio or another MCP client |
| Clear improvement | The diff removes a timeout; the original incident explains why it exists | Fixture PR #207 reverses #42; keep the fictional fixture label visible |
| Actionable result | `draft_review` produces cited comments for human inspection | Drafts never post; `expected_head` rejects a draft after a PR update; readonly demonstrates a dry run |
| Follow-up review | Read replies and surrounding code, inspect new commits and revisit saved findings | Four tools plus `review-pr-update`; missing evidence is reported and absent findings are not called fixed |
| Reliable execution | Show the full workflow, then the role boundary | `npm test` and `npm run demo`; real GitHub integration also checked on a public PR without posting |
| Live demo | A judge can connect to the deployed MCP URL | NitroCloud deployment and a remote retest still required; follow the README |

## Record the demo

Use the 90-second sequence in [DEMO.md](DEMO.md). Start with the timeout removal
and show the old incident beside the new finding. End with the cited draft and
denied secret-path request. Show the evidence card during the rule check rather
than spending time touring all the tools.

The fixture demonstrates the intended regression clearly. The separate live
GitHub smoke check verifies integration and honest empty results; it does not
establish detection accuracy. Do not present fixture links as real incidents.

## Remaining submission requirements

The guide's section 8 requires:

- A public GitHub repository with a README.
- The project name, original product and short workflow explanation.
- A video showing the working workflow.
- A live deployed demo URL, tested from another browser or network.
- A LinkedIn post tagging the official MCP to the Moon handle and any applicable
  partnered community; the portal needs the post link.

Use the event's submission portal only when everything is ready: the guide says
submissions lock once made. Confirm the portal, deadline and exact social handles
from the organizers; this guide does not provide all of them.
