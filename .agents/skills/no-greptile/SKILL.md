---
name: no-greptile
description: Apply and verify Rudder's no-greptile pull-request label. Use when creating, updating, or reviewing a PR that the user explicitly wants to exclude from Greptile automated review.
---

# No Greptile

Use the `no-greptile` GitHub label to skip Greptile automated review for a specific pull request.
Apply it only when the user explicitly requests that review skip.

1. Resolve the pull request number from the current branch or user request.
2. Apply the label:

   ```bash
   gh pr edit <pr-number> --add-label no-greptile
   ```

3. Verify that the label is present:

   ```bash
   gh pr view <pr-number> --json labels
   ```

Do not remove the label or alter other review settings unless the user asks.
