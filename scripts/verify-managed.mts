/** Offline integration proof against an actual OpenPond checkout's RL adapter.
 * No job, provider request, or optimizer update is created by this script.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root, inspectTask } from "../agents/retail/src/runtime.js";
import { z } from "zod";
const checkout = process.argv[2];
if (!checkout) throw new Error("Supply the OpenPond checkout path");
const { executePortableJsonlTraining } = await import(
  pathToFileURL(
    path.join(
      checkout,
      "apps/server/src/training/portable-jsonl-training-adapter.ts",
    ),
  ).href
);
const storeDir = path.join(root, "artifacts", "managed-contract-test");
const id = "tau-retail-managed-contract";
const taskRoot = path.join(storeDir, "training", "tasksets", id);
await mkdir(path.join(taskRoot, "graders"), { recursive: true });
const source = `import sys, json, os
sys.path.insert(0, ${JSON.stringify(path.join(root, "python"))})
os.environ['OPENPOND_OPCHAT_BASE_URL']='https://staging-api.openpond.ai/opchat/v1'
os.environ['OPENPOND_API_KEY']='offline-contract-test'
import managed_runtime as runtime
from tau2.user.user_simulator import UserSimulator
from tau2.data_model.message import UserMessage
class Customer(UserSimulator):
    def __init__(self):
        super().__init__(llm='offline-test')
        self.turns=0
    def generate_next_message(self,message,state):
        self.turns+=1
        return UserMessage(role='user',content='Please help me.' if self.turns==1 else '###STOP###'),state
runtime.bridge.AgentGymEnv._get_user=lambda _:Customer()
for line in sys.stdin:
    print(json.dumps(runtime.execute(json.loads(line))),flush=True)
`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
await writeFile(path.join(taskRoot, "graders", "runtime.py"), source);
await writeFile(
  path.join(taskRoot, "graders", "managed-rl-runtime.json"),
  JSON.stringify({
    protocolVersion: "openpond.managedRlJsonlRuntime.v1",
    module: "graders/runtime.py",
    moduleSha256: sha(source),
    command: [path.join(root, ".venv/bin/python"), "{module}"],
    cwd: root,
    maxTurns: 24,
  }),
);
const inspected = z
  .object({
    tools: z.array(z.object({ function: z.object({ name: z.string() }) })),
    task: z.object({
      evaluation_criteria: z.object({
        actions: z.array(
          z.object({
            name: z.string(),
            arguments: z.record(z.string(), z.unknown()),
          }),
        ),
      }),
    }),
  })
  .parse(await inspectTask("33", AbortSignal.timeout(120_000)));
// This is the adapter boundary fixture, not a published/admitted Taskset.
const task = {
  id: "task-33",
  split: "train",
  metadata: { benchmarkTaskId: "33" },
};
const taskset = {
  id,
  revision: 1,
  contentHash: "a".repeat(64),
  metadata: {},
  tasks: [task],
  environment: {
    kind: "stateful_harness",
    defaultTimeoutMs: 120000,
    metadata: {},
    toolNames: [...inspected.tools.map((t) => t.function.name), "done"],
  },
  capabilities: { requiresState: true, requiresTools: true },
  graders: [{ id: "tau-retail-native-db", rewardEligible: true }],
};
const actions = inspected.task.evaluation_criteria.actions;
let count = 0;
const result = await executePortableJsonlTraining({
  taskset,
  task,
  storeDir,
  harnessRoot: root,
  executorId: "offline-contract-test",
  signal: AbortSignal.timeout(120_000),
  claim: {
    schemaVersion: "openpond.managedRlLocalRolloutClaim.v1",
    executionKind: "evaluation",
    executionId: "offline-eval",
    jobId: "offline-job",
    groupId: null,
    rolloutId: null,
    deliveryId: "offline-delivery",
    policyVersion: 0,
    task: { id: task.id, expectedText: null },
    taskset: { id, revision: 1, contentHash: taskset.contentHash },
    harnessRelease: { id: "offline-harness", contentHash: "b".repeat(64) },
    reward: {
      kind: "local_harness_receipt_v1",
      environmentId: "portable-jsonl-stateful-v1",
    },
    environmentSha256: "c".repeat(64),
    request: { seed: 0 },
    policy: { path: "not-called", token: "offline-test" },
  },
  policyRequest: async (request: Record<string, unknown>) => {
    const action = actions[count++];
    if (request.policyVersion !== 0 || request.returnTokenIds !== true)
      throw new Error("Managed policy request lost training fields");
    return {
      response: {
        choices: [
          {
            message: {
              content: action ? null : "Completed.",
              tool_calls: action
                ? [
                    {
                      id: `call-${count}`,
                      type: "function",
                      function: {
                        name: action.name,
                        arguments: JSON.stringify(action.arguments),
                      },
                    },
                  ]
                : [],
            },
          },
        ],
      },
      trainingSample: { modelRequestId: `offline-request-${count}` },
    };
  },
});
const checked = z
  .object({
    status: z.literal("succeeded"),
    trace: z.object({
      schemaVersion: z.literal("openpond.managedRlLocalHarnessReceipt.v2"),
      reward: z.literal(1),
      terminal: z.literal(true),
      modelRequestIds: z.array(z.string()),
      trainingSampleSha256s: z.array(z.string()),
    }),
  })
  .parse(result);
if (checked.trace.modelRequestIds.length !== actions.length + 1)
  throw new Error("Missing per-turn managed receipt identity");
await writeFile(
  path.join(storeDir, "receipt.json"),
  JSON.stringify(
    {
      evidenceKind: "offline-adapter-contract-fixture",
      notActualTraining: true,
      result,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    status: "passed",
    adapter: "executePortableJsonlTraining",
    nativeReward: checked.trace.reward,
    policyTurns: count,
    receipt: path.join(storeDir, "receipt.json"),
  }),
);
