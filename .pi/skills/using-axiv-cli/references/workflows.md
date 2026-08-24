# axiv CLI Workflows

## Literature Review

Run `axiv auth status --json` and stop if authentication or tool compatibility fails.

Confirm that the user wants a quota-consuming discovery call when their request does not already make that intent clear.

Run `axiv research discover` with only the user's question, stated keywords, requested dates, difficulty, and priority.

Use `axiv paper query` once per selected paper with every question for that paper batched as repeated `--query` options.

Synthesize only claims supported by returned paper content and identify gaps without silently spending more quota.

## Single-Paper Research

Use `axiv paper content PAPER --json` for the intermediate report.

Use `--full-text` only when raw extracted text is necessary or the report is insufficient.

Use `axiv paper query` for page-level evidence and batch related questions in one call.

Stop on an unresolved paper, quota exhaustion, or content that does not support the requested conclusion.

## PDF Evidence Extraction

Keep all questions about one paper in one `axiv paper query` command.

Preserve the returned page identifiers when citing evidence.

Do not claim that filtered pages represent the entire paper.

Run another quota-consuming query only after the user authorizes the additional research when the original request did not cover it.

## Code Verification

Obtain the paper's actual GitHub URL from a paper result or from the user.

Run `axiv paper code REPOSITORY / --json` to inspect the repository tree and top-level files.

Read only the specific files or directories needed to verify the claim.

Stop if the repository is not on HTTPS GitHub, the path is ambiguous, or the code cannot support the claim.

## Personal Library Organization

Run `axiv library list --json` to resolve folder names to opaque folder IDs.

Draft the exact write command without `--yes` and state every target folder and paper.

Ask the user to authorize that exact save, remove, move, create, rename, or delete operation.

Add `--yes --json` only after authorization matches the final command.

Inspect the stable result and report partial outcomes without automatically retrying.

For deletion, remind the user that the folder and its paper memberships will be removed while the papers remain elsewhere.
