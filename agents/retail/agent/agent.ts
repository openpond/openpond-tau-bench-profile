import {
  action,
  defineAgentProject,
  defineInstructions,
  defineWorkflow,
  defineEval,
} from "openpond-agent-sdk";
import { z } from "zod";
import { catalog, inspectTask } from "../src/runtime.js";
import { fixture } from "../src/fixture.js";
import { runAttempt, fireworksPolicy } from "../src/attempt.js";

const taskInput = {
  type: "object",
  properties: { taskId: { type: "string", minLength: 1 } },
  required: ["taskId"],
  additionalProperties: false,
} as const;
const operations = [
  {
    id: "chat",
    label: "Browse retail tasks",
    description:
      "List upstream retail tasks and their executable grading requirements.",
    run: async (_input: unknown) => catalog(AbortSignal.timeout(120_000)),
  },
  {
    id: "inspect-task",
    label: "Inspect task",
    description:
      "Inspect author-only task source, policy, tools and native criteria; not model context.",
    run: async (input: unknown) =>
      inspectTask(
        z.object({ taskId: z.string() }).parse(input).taskId,
        AbortSignal.timeout(120_000),
      ),
  },
  {
    id: "check-fixture",
    label: "Check native grading",
    description:
      "Run positive and negative reference fixtures through OpenPond Harness. No model calls.",
    run: async (input: unknown) => {
      const { taskId } = z.object({ taskId: z.string() }).parse(input);
      return {
        positive: await fixture(taskId, true, AbortSignal.timeout(120_000)),
        negative: await fixture(taskId, false, AbortSignal.timeout(120_000)),
      };
    },
  },
  {
    id: "run-task",
    label: "Run retail task",
    description:
      "Run a fresh customer conversation using current OpChat and Fireworks. Uses paid model calls.",
    run: async (input: unknown) =>
      runAttempt({
        taskId: z.object({ taskId: z.string() }).parse(input).taskId,
        live: true,
        signal: AbortSignal.timeout(180_000),
        policy: fireworksPolicy(),
      }),
  },
];
const workflows = operations.map((op) =>
  defineWorkflow({
    name: op.id,
    description: op.description,
    async run(_ctx, input) {
      const result = await op.run(input);
      return { text: JSON.stringify(result), metadata: { result } };
    },
  }),
);
export default defineAgentProject({
  name: "tau-retail",
  version: "0.1.0",
  description:
    "Executable τ retail Profile with native tools, state and grading.",
  useCase: "retail-task-inspection",
  manifestMode: "typescript",
  runtime: { base: "node-bun-workspace" },
  instructions: defineInstructions("./agent/instructions.md"),
  defaultAction: "chat",
  inputSchema: {
    type: "object",
    properties: { prompt: { type: "string" } },
    additionalProperties: false,
  },
  inputSchemas: {
    TaskInput: taskInput,
    ChatInput: {
      type: "object",
      properties: { prompt: { type: "string" } },
      additionalProperties: false,
    },
  },
  workflows,
  actions: operations.map((op, i) =>
    action(op.id, {
      label: op.label,
      description: op.description,
      target: { kind: "workflow", workflow: workflows[i]! },
      visibility: "end_user",
      timeoutSeconds: 300,
      inputSchema: op.id === "chat" ? "ChatInput" : "TaskInput",
      approval: {
        mode: op.id === "run-task" ? "always" : "never",
        reason:
          op.id === "run-task"
            ? "Live acting-model and customer-simulator calls incur usage."
            : "Local source inspection or deterministic isolated fixture.",
      },
      setup:
        op.id === "run-task"
          ? [
              {
                kind: "env",
                name: "OPENPOND_API_KEY",
                required: true,
                description: "OpChat authentication supplied by the host.",
              },
              {
                kind: "env",
                name: "OPENPOND_OPCHAT_BASE_URL",
                required: true,
                description: "Current OpenPond OpChat URL.",
              },
            ]
          : [],
    }),
  ),
  evals: [
    defineEval({
      name: "native-positive-negative",
      description:
        "The same native case must distinguish correct state changes from no changes.",
      publishGate: true,
      async run() {
        const signal = AbortSignal.timeout(120_000);
        const positive = await fixture("33", true, signal);
        const negative = await fixture("33", false, signal);
        if (
          positive.finalStep.grading?.reward !== 1 ||
          negative.finalStep.grading?.reward !== 0
        )
          throw new Error(
            "Native grading failed to distinguish expected state",
          );
      },
    }),
  ],
});
