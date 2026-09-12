import { z } from "zod";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  EnvironmentReleaseSchema,
  VerifierSetReleaseSchema,
} from "@openpond/evals";
import {
  createLearningTextAsset,
  learningRef,
  sealLearningContent,
  TaskDefinitionSchema,
} from "@openpond/evals/learning";
import {
  compileBoundGraders,
  RewardBindingSchema,
  RewardReleaseSchema,
} from "@openpond/evals/rewards";
import { TasksetReleaseSchema } from "@openpond/evals/tasksets";
import { contentHash } from "@openpond/harness";
import { validateModelTasksetPackage } from "openpond-sdk/model-starters";
import { createTasksetPackage } from "openpond-sdk/taskset-packages";
import {
  catalog,
  inspectTask,
  revision,
  root,
} from "../agents/retail/src/runtime.js";

function release<T extends { contentHash: string }>(
  schema: z.ZodType<T>,
  value: Record<string, unknown>,
): T {
  const parsed = schema.parse(sealLearningContent(value));
  const { contentHash: _hash, ...content } = parsed;
  return schema.parse(sealLearningContent(content));
}

const profileRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const profile = {
  repository: "openpond/openpond-tau-bench-profile",
  revision: profileRevision,
  profile: "tau-retail",
  agent: "retail",
  action: "run-task",
  upstreamRevision: revision,
};
const list = z
  .object({
    tasks: z.array(z.object({ id: z.string(), runnable: z.boolean() })),
  })
  .parse(await catalog(AbortSignal.timeout(120000)));
const inspection = z.object({
  task: z.object({ id: z.string() }).catchall(z.json()),
  policy: z.string(),
  tools: z.array(
    z.object({
      function: z.object({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.json()),
      }),
    }),
  ),
});
const cases = await Promise.all(
  list.tasks
    .filter((t) => t.runnable)
    .map(async (t) =>
      inspection.parse(await inspectTask(t.id, AbortSignal.timeout(120000))),
    ),
);
const instructions = cases[0]!.policy.trim();
const assets = await Promise.all(
  ["verify.mjs", "verify.py"].map(async (file) =>
    createLearningTextAsset({
      path: `graders/${file}`,
      text: await readFile(`${root}/graders/${file}`, "utf8"),
      mediaType: file.endsWith(".py")
        ? "text/x-python"
        : "application/javascript",
      visibility: "verifier",
    }),
  ),
);
const reward = release(RewardReleaseSchema, {
  schemaVersion: "openpond.rewardRelease.v1",
  id: "tau-retail-native-db",
  revision: 1,
  name: "τ Retail native database grader",
  description:
    "Recomputes the pinned upstream native database evaluator from the host-recorded conversation and private task. Requires the executable τ profile runtime.",
  implementation: {
    kind: "custom_verifier",
    runtime: "sandbox_process",
    verifierRef: assets[0]!.asset,
    exportName: "verify",
    timeoutMs: 30000,
    networkPolicy: "none",
  },
  rawScore: { minimum: 0, maximum: 1 },
  assets: assets.map((a) => a.asset),
});
const binding = release(RewardBindingSchema, {
  schemaVersion: "openpond.rewardBinding.v1",
  id: "tau-retail-native-grading",
  revision: 1,
  name: "τ Retail native grading",
  sources: [
    {
      graderId: reward.id,
      reward: learningRef(reward),
      role: "training",
      normalization: { kind: "identity" },
      weight: 1,
      required: true,
      hardGate: true,
      privileged: true,
      fixtureRefs: [],
    },
  ],
  aggregation: "weighted_mean",
  unscorable: "exclude_optional_require_all_required",
});
const graders = compileBoundGraders(binding, [reward]);
const environment = release(EnvironmentReleaseSchema, {
  schemaVersion: "openpond.environmentRelease.v1",
  id: "tau-retail-profile-environment",
  revision: 1,
  contract: {
    protocolVersion: "openpond.environment.v1",
    kind: "agent",
    entrypoint: "openpond.profile-task.v1",
    stateful: true,
    deterministicSeeds: true,
    lifecycle: ["create", "reset", "step", "collect", "destroy"],
    networkPolicy: "declared_scoped",
    defaultTimeoutMs: 180000,
  },
  actionSchemaRef: null,
  observationSchemaRef: null,
  stateSchemaRef: null,
  artifactCollection: { maxArtifacts: 10, maxTotalBytes: 10485760 },
  adapterConformanceHashes: {},
  metadata: { profile, executionStatus: "requires_profile_task_runtime" },
});
const verifierSet = release(VerifierSetReleaseSchema, {
  schemaVersion: "openpond.verifierSetRelease.v1",
  id: "tau-retail-native-verifiers",
  revision: 1,
  graders,
  isolation: {
    processBoundary: "isolated_process",
    networkPolicy: "none",
    defaultTimeoutMs: 30000,
  },
  calibrationReceiptRefs: [],
  metadata: { profile },
});
const tools = cases[0]!.tools.map((t) => ({
  name: t.function.name,
  description: t.function.description ?? "",
  inputSchema: t.function.parameters,
  inputSchemaHash: contentHash(t.function.parameters),
  sideEffect: "write" as const,
  timeoutMs: 10000,
}));
const execution = {
  policy: {
    policyVisibleFields: ["input", "policyVisibleContext"],
    privilegedFields: ["expectedOutput", "privilegedContextRef"],
    hiddenGraderRefs: [reward.id],
    connectedAppScopes: [],
  },
  environment: environment.contract,
  environmentRelease: {
    id: environment.id,
    contentHash: environment.contentHash,
  },
  verifierSetRelease: {
    id: verifierSet.id,
    contentHash: verifierSet.contentHash,
  },
  tools,
  capabilities: [],
};
const definition = release(TaskDefinitionSchema, {
  schemaVersion: "openpond.taskDefinition.v1",
  id: "tau-retail-profile-tasks",
  revision: 1,
  name: "τ Retail",
  description:
    "Selected native retail scenarios from the executable τ profile.",
  instructions,
  category: "tool_workflow",
  familyNamespace: "tau-retail-customer",
  inputSchema: {
    type: "object",
    properties: { taskId: { type: "string" } },
    required: ["taskId"],
    additionalProperties: false,
  },
  outputSchema: { type: "object" },
  rewardBinding: learningRef(binding),
  harness: null,
  execution,
});
const tasks = cases.map((c) => ({
  id: c.task.id,
  clusterKey: "tau-retail-shared-customer-demo",
  split: "train" as const,
  input: { taskId: c.task.id },
  expectedOutput: { task: c.task },
  policyVisibleContext: { instructions },
  privilegedContextRef: null,
  artifactRefs: [],
  tags: ["tau2-retail", "native-db", "demo"],
}));
const taskset = release(TasksetReleaseSchema, {
  schemaVersion: "openpond.tasksetRelease.v2",
  id: "tau-retail-demo",
  revision: 1,
  ...execution,
  tasks,
  graders,
  metadata: {
    taskPreviews: Object.fromEntries(
      cases.map((c) => [c.task.id, c.task.user_scenario]),
    ),
    starter: {
      taskDefinition: learningRef(definition),
      rewardBinding: learningRef(binding),
    },
    profile,
    provenance: {
      repository: "sierra-research/tau2-bench",
      revision,
      license: "MIT",
    },
    executionStatus: "requires_profile_task_runtime",
    demoOnly: true,
  },
});
const model = validateModelTasksetPackage({
  taskset,
  taskDefinition: definition,
  rewardBinding: binding,
  rewards: [reward],
  assets,
  executionResources: { environment, verifierSet },
});
const {
  taskset: _tasks,
  executionResources: _execution,
  ...modelResources
} = model;
const result = createTasksetPackage({
  schemaVersion: "openpond.tasksetPackage.v1",
  taskset,
  environment,
  verifierSet,
  modelResources,
  files: assets.map((a) => ({
    asset: a.asset,
    base64: Buffer.from(a.text).toString("base64"),
  })),
});
await mkdir(`${root}/exports`, { recursive: true });
await writeFile(
  `${root}/exports/retail.taskset.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    tasks: tasks.map((t) => t.id),
    profileRevision,
    packageHash: result.contentHash,
  }),
);
