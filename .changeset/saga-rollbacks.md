---
"@cloudflare/workflows-shared": minor
---

Add saga rollback support for local Workflows development

Workflow steps can now register a compensation callback via `step.do(...).rollback(fn)` (and `.waitForEvent(...).rollback(fn)`). When the workflow fails, the local engine runs every registered rollback in reverse insertion order (LIFO), giving steps the opportunity to undo their side effects.

Each rollback executes through `Context.do` with `setRollbackStep`, so it inherits the existing retry / timeout / attempt-tracking machinery — `.rollback(config, fn)` lets users override the per-rollback config. Rollback lifecycle is logged via new `ROLLBACK_*` `InstanceEvent` values surfaced by the local explorer.

Note: the public `step.do(...).rollback(...)` type lands with workerd's `workflows_step_rollback` compat flag (PR cloudflare/workerd#6330). Until that ships, the trailing rollback arg only flows through when called through the StepPromise wrapper from a worker that has the flag enabled.
