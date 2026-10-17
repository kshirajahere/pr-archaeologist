# 90-second demo

Before recording: run `npm test`, then `npm run demo`. Keep NitroStudio on the
project with `MOCK=1` and `MCP_API_KEY=demo-readonly`. Use `acme/launchpad`, PR 207.
All repository names, people and links in this snapshot are fictional. The
GitHub adapter uses real URLs in live mode. No rate limits or live account are
needed for this recording.

| Time | Screen action | Narration |
| --- | --- | --- |
| 0–12s | Show `pr_context`'s visible `src/client.ts` diff. | “This PR removes a little boilerplate. A diff-only review has no record of the outage that made these lines necessary.” |
| 12–28s | Run `why_line` with `{"repo":"acme/launchpad","path":"src/client.ts","line":3}`. Highlight PR #42, the review quote and issue #41. | “PR Archaeologist follows the line back through its commit, PR, review and incident. That timeout exists because a stalled upstream exhausted our workers.” |
| 28–44s | Run `extract_team_rules`, then `check_pr_against_rules`. Open the review card and point to the first source link. | “It finds four recurring rules. This one quotes a review from October 2024, two years earlier. Each flag connects the changed line to the original comment, with its source and confidence.” |
| 44–57s | Run `decision_conflicts` for PR 207. Highlight the removed timeout and restored fetch call. | “The new PR exactly reverses the fix from #42. This is evidence of a possible regression, with the old fix linked for the reviewer.” |
| 57–68s | Run `find_reviewers`. Highlight Nikhil's score and evidence URLs. | “It suggests the people who changed or reviewed these exact paths. Nikhil authored the relevant fixes.” |
| 68–79s | Show `post_review` dry-run output from the prompt or `npm run demo`. | “Readonly can prepare the review but cannot publish it. Reviewer can post. Docs-bot can only leave inline comments under docs.” |
| 79–90s | Run `why_line` for `.env`, line 1. Show `not found`, then `audit://log`. | “Ask this agent for dot-env: not found. The denied call is audited. Review with the team's memory, inside the agent's role.” |

The “before” is illustrative, not an asserted model benchmark. Keep the fixture
label visible. The original-comment links show the provenance format; do not
claim this fictional repository's links are live historical evidence.

If Studio's UI or chat model is unavailable, `npm run demo` runs the same tool
sequence over real MCP stdio and asserts the results. Its complete response
payloads are in `logs/demo-output.json`; the source fixture is
`fixtures/github.json`. This fallback requires no model provider API key.

Useful inputs:

```json
{"repo":"acme/launchpad","pr":207}
```

```json
{"repo":"acme/launchpad","path":".env","line":1}
```

For a manual dry run:

```json
{
  "repo": "acme/launchpad",
  "pr": 207,
  "body": "Please retain the timeout fix from #42.",
  "comments": [{
    "path": "src/client.ts",
    "line": 3,
    "body": "The timeout prevents worker exhaustion. Source: https://github.com/acme/launchpad/pull/42#discussion_r4201"
  }]
}
```
