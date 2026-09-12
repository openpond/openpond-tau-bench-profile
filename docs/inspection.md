# Local inspection receipt — 2026-09-12

The standalone Profile is built in this repository. Source is prepared for the public `openpond/openpond-tau-bench-profile` repository. Profile installation and Models/managed RL attachment remain unverified.

| Check | Observed result |
| --- | --- |
| Retail case 33 native reference fixture | Correct state: 1; unchanged state: 0 |
| Retail case 34 native reference fixture | Correct state: 1; unchanged state: 0 |
| State reset | Repeating case 33 from a fresh process yields the same final state hash |
| Harness history | Tool-call IDs match retained tool-result IDs |
| Cancellation | Cancelled process rejects further operations |
| τ Gym/orchestrator protocol | Scripted customer, actual retail tools and native terminal grading pass |
| Agent SDK | Build, validation (zero warnings), eval and direct inspect action pass |
| TypeScript | Typecheck passes |
| Setup | Frozen Bun install and locked Python sync pass |
| Paid Fireworks conversation | Not run |
| Models Task import / managed RL | Not attached |

`bun run check` passed: two Bun boundary tests, one Python protocol test, typecheck and Agent SDK build/validation/eval. The SDK eval's publish gate passed; this is test evidence, not authorization to publish.

The first review should inspect `agents/retail/agent/agent.ts`, `agents/retail/src/attempt.ts` and `python/bridge.py`. The shared Harness implementation is imported from the published package; it has not been forked or copied. Retail policy, tools and database logic come from the pinned upstream checkout.

The current local actions browse tasks, inspect their source, check grading fixtures and run a live attempt. They do not yet expose individually hosted retail action bindings to managed RL. That attachment and canonical Task/package import should be designed after reviewing this executable Profile.

## Import and managed protocol — 2026-09-12

The GitHub commit `6b30b73085926550d1f61df7d9a04748cbf585ba` was installed using OpenPond's `installOpenPondProfile` into a separate local test home. After the documented setup, OpenPond's own `runProfileCheck('all')` passed. The refreshed catalog exposed all four actions with no stale/error state, and `runProfileSdkCommand` successfully invoked `inspect-task` for case 33.

The default local home did not finish registration promptly and that attempt was interrupted; the successful proof above applies specifically to the separate test home, not the user's default app installation. The installer clones/registers source; setup and SDK catalog building are still explicit steps.

The existing managed JSONL adapter also passed an offline protocol integration test: actual τ tools/evaluator, scripted customer, seven controlled policy turns, native reward 1, v2 receipt and per-turn sample identity. No training job or paid inference was created. Canonical Task import, immutable runtime materialization and managed submission remain pending.
