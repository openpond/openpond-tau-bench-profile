import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  decodeTasksetPackageFile,
  validateTasksetPackage,
} from "openpond-sdk/taskset-packages";
import { fixture } from "../agents/retail/src/fixture.js";
import { root } from "../agents/retail/src/runtime.js";

test("export retains native private tasks and native verifier recomputes both outcomes", async () => {
  const value = validateTasksetPackage(
    JSON.parse(await readFile(`${root}/exports/retail.taskset.json`, "utf8")),
  );
  expect(value.taskset.tasks.map((t) => t.id)).toEqual(["33", "34"]);
  expect(value.taskset.tasks.every((t) => !("task" in t.input))).toBe(true);
  expect(value.modelResources!.rewards[0]!.implementation.runtime).toBe(
    "sandbox_process",
  );
  for (const correct of [true, false]) {
    const result = await fixture("33", correct, AbortSignal.timeout(120000));
    const verified = spawnSync(
      `${root}/.venv/bin/python`,
      [`${root}/graders/verify.py`],
      {
        input: JSON.stringify({
          expected: value.taskset.tasks[0]!.expectedOutput,
          evaluatorContext: { simulation: result.finalStep.simulation },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          TAU2_DATA_DIR: `${root}/vendor/tau2-bench/data`,
          PYTHON_DOTENV_DISABLED: "1",
        },
        timeout: 30000,
      },
    );
    expect(verified.status).toBe(0);
    expect(JSON.parse(verified.stdout).score).toBe(correct ? 1 : 0);
  }
}, 120000);

test("export retains the immutable portable runtime closure", async () => {
  const value = validateTasksetPackage(
    JSON.parse(await readFile(`${root}/exports/retail.taskset.json`, "utf8")),
  );
  const files = new Map(value.files.map((file) => [file.asset.path, file]));
  for (const path of [
    "graders/managed-rl-runtime.json",
    "python/managed_runtime.py",
    "python/bridge.py",
    "requirements.lock",
    "UPSTREAM.json",
    "vendor/tau2-bench/pyproject.toml",
    "vendor/tau2-bench/src/tau2/domains/retail/environment.py",
    "vendor/tau2-bench/data/tau2/domains/retail/db.json",
    "vendor/tau2-bench/data/tau2/domains/retail/tasks.json",
  ]) {
    expect(files.has(path)).toBe(true);
    expect(files.get(path)!.asset.visibility).toBe("host_private");
  }
  const config = JSON.parse(
    new TextDecoder().decode(
      decodeTasksetPackageFile(files.get("graders/managed-rl-runtime.json")!),
    ),
  );
  expect(config).toMatchObject({
    protocolVersion: "openpond.managedRlJsonlRuntime.v1",
    module: "python/managed_runtime.py",
    command: ["python3", "{module}"],
    dependencyLock: "requirements.lock",
    upstreamRevision: "672227c6b6676edc20d57ea53b7000262aae77b9",
  });
  expect(config.moduleSha256).toBe(
    files.get("python/managed_runtime.py")!.asset.contentHash,
  );
  expect(config.dependencyLockSha256).toBe(
    files.get("requirements.lock")!.asset.contentHash,
  );
});
