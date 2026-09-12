# OpenPond τ Retail

A standalone executable OpenPond Profile for inspecting and running pinned τ retail tasks. OpenPond Harness owns the acting-model loop; the profile supplies upstream retail tools, store state, customer simulation and native grading.

Source repository: [openpond/openpond-tau-bench-profile](https://github.com/openpond/openpond-tau-bench-profile). This is an inspection-stage Profile; it has not been published to npm, imported into Models, or attached to managed RL.

## Try it

Requirements: Git, Bun, and uv. Setup installs Python 3.12, locked dependencies and the pinned upstream source.

```bash
./scripts/setup.sh
bun scripts/inspect.ts catalog
bun scripts/inspect.ts inspect 33
bun scripts/inspect.ts demo 33
bun scripts/inspect.ts demo 34
```

Each inspection command prints the path to a saved JSON artifact under `artifacts/`. `inspect` is an author view containing private scenario and grading information; it is never used as acting-model context.

The catalog contains all 114 upstream retail cases. Cases **33 and 34** are executable in this first profile because their native reward basis is database state. Other cases are visible but rejected for execution until their additional grading capabilities are qualified. This is capability admission based on the task's declared reward basis, not hardcoded task-ID routing.

`demo` runs a positive reference-action fixture and a negative no-change fixture through the published `@openpond/harness` round loop, real τ tools, isolated store instances and τ's native evaluator. These are deliberately privileged, deterministic grading fixtures—not model-generated conversations, simulated-customer tests or benchmark scores. They produce native rewards 1 and 0.

## Profile actions

| Action | Behavior |
| --- | --- |
| `chat` | Browse cases and native grading requirements without model calls. |
| `inspect-task` | Inspect the selected case, upstream policy and tool schemas. Author-only output. |
| `check-fixture` | Execute positive/negative native fixtures for the selected case. |
| `run-task` | Run a fresh model/customer conversation through OpChat → Fireworks. Requires explicit paid-run approval in the Agent action contract. |

For example, use the existing Agent SDK CLI:

```bash
bunx openpond-agent run inspect-task --cwd agents/retail --input '{"taskId":"33"}' --json
```

The default `chat` action is a deterministic task browser. It is not a second conversational agent or a replacement for Work.

## Live attempts

Supply `OPENPOND_API_KEY` and `OPENPOND_OPCHAT_BASE_URL` to the process through your normal credential mechanism. The only accepted base URLs are `https://staging-api.openpond.ai/opchat/v1` and `https://api.openpond.ai/opchat/v1`. Both the acting model and customer simulator use `accounts/fireworks/models/deepseek-v4-flash` through that gateway. The upstream library's `openai/` prefix selects the compatible wire protocol; it does not route to OpenAI's API.

```bash
bun scripts/inspect.ts run 33
```

This command incurs model usage. It is bounded to 24 Harness rounds by default, at most 50 when called programmatically, 2,048 output tokens per model request and a three-minute attempt deadline. These are execution bounds, not a dollar-denominated spending guarantee. No automatic retry is added by the acting-model client. Paid live inference has **not** been verified in this repository; only the transport configuration and offline conversation protocol have been tested. Review usage/budget admission before running it or attaching it to managed infrastructure.

Saved live attempts contain Harness messages and tool events, acting-model usage receipts and the native simulation/grading result. Upstream simulator accounting is retained as supplied and is not a reconciled OpenPond billing ledger. Runtime/provider errors are errors, not successful native scores.

## Where the code lives

```text
openpond-profile.json          Profile registration
settings/profile.yaml         Existing OpenPond profile layout
agents/retail/agent/           Agent SDK actions and instructions
agents/retail/src/runtime.ts   Bounded private Python process
agents/retail/src/attempt.ts   Existing OpenPond Harness + OpChat transport
agents/retail/src/fixture.ts   Explicit privileged reference test driver
python/bridge.py               Pinned native tools, Gym and evaluator bridge
scripts/                      Setup and local inspection commands
tests/                        Native state, cancellation and Gym protocol tests
vendor/                       Ignored upstream checkout installed by setup
```

Retail tool schemas and policy are loaded from τ, not reimplemented here. The live bridge uses τ Gym's structured messages to preserve tool-call IDs; those internal APIs are covered by a protocol test and tied to the exact upstream commit. Each attempt has a separate Python process and fresh store. Closing/cancelling the runtime kills that process, including simulator threads.

The inspection artifact schema is local to this profile. It is **not** a new canonical OpenPond Taskset format. Mapping selected cases into existing Task packages, publishing immutable Profile references, Models UI attachment and managed RL admission are the next design review. Do not treat these local artifacts as already-admitted training inputs.

## Managed pipeline attachment

`python/managed_runtime.py` implements the existing `openpond.managedRlJsonlRuntime.v1` init/step/terminate protocol. It supplies native retail tools, advances the Fireworks customer and returns native reward components. The managed pipeline owns the acting policy requests, token/log-probability evidence and per-turn training samples; the profile must not call the fixed Fireworks acting model when used in this lane.

The production OpenPond `executePortableJsonlTraining` adapter has been exercised against this wrapper with a scripted customer and privileged reference policy. Seven policy turns produced a v2 local Harness receipt with native reward 1 and per-turn request/sample identities. This is explicitly an offline adapter-contract fixture, not an actual hosted job or optimizer update. The verification script accepts an OpenPond source checkout path: `scripts/verify-managed.mts`.

Canonical Task/package materialization, immutable dependency admission, separate train/evaluation cases, live simulator usage qualification and an actual managed job remain unfinished. Cases 33/34 share a customer/store scenario and must not be presented as independent held-out generalization evidence.

## Checks

```bash
bun run typecheck
bun test tests
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
bun run agent:build
bun run agent:validate
bun run agent:eval
```

The Python protocol test drives the actual τ Gym/orchestrator with a scripted customer and reference actions. It checks preserved tool IDs and terminal native grading without provider requests. It does not establish simulator model quality.

## Upstream and publication

Upstream: Sierra Research's [τ2-bench](https://github.com/sierra-research/tau2-bench), commit `672227c6b6676edc20d57ea53b7000262aae77b9`. The dependency is fetched during setup; we do not duplicate the retail dataset or tool implementations in this repo. See `UPSTREAM.json` and `THIRD_PARTY_LICENSE_TAU.txt` for attribution and the upstream MIT license.

The profile source uses MIT licensing. GitHub source publication does not establish Profile installation or managed execution qualification. No customer credentials, generated attempts or upstream checkout belong in the public source tree.

### Models task package

`bun scripts/export-model.ts` exports the qualified DB cases into
`exports/retail.taskset.json`, using the normal OpenPond Taskset package and
Grader contracts. It preserves customer-private scenarios and native criteria in
`expectedOutput`, with only the case ID and retail policy visible to the policy.
The package pins the executable profile commit and upstream revision. The native
process Grader recomputes upstream evaluation from a host-recorded simulation;
model-supplied scores are never accepted. Python, pinned tau2 and its data must be
materialized by the profile runtime before execution.

The Models Get Started importer can save selected tasks and this Grader now.
Hosted profile task execution and managed RL admission remain separate work.
Both cases belong to the same demonstration family; this is not a held-out
benchmark split. Regenerate the export after committing executable source so its
profile revision points to the exact implementation being imported.
