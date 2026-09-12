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
