import { test, expect } from "bun:test";
import { fixture } from "../agents/retail/src/fixture.js";
import { RetailRuntime } from "../agents/retail/src/runtime.js";
// Protect native scoring, fresh-state isolation and retained Harness tool IDs.
test("native state distinguishes successful and failed attempts and reopens from fresh state", async () => {
  const signal = AbortSignal.timeout(120_000);
  const good = await fixture("33", true, signal);
  const bad = await fixture("33", false, signal);
  const repeat = await fixture("33", true, signal);
  expect(good.finalStep.grading?.reward).toBe(1);
  expect(bad.finalStep.grading?.reward).toBe(0);
  expect(repeat.finalStep.stateHash).toBe(good.finalStep.stateHash);
  expect(
    good.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
  ).toEqual(good.messages.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []));
}, 120_000);
// A cancelled host must not leave a Python task accepting state changes.
test("cancellation closes the task process", async () => {
  const controller = new AbortController();
  const runtime = new RetailRuntime(controller.signal);
  const pending = runtime.request({ op: "catalog" });
  controller.abort();
  await expect(pending).rejects.toThrow();
  await expect(runtime.request({ op: "catalog" })).rejects.toThrow("closed");
  runtime.close();
});
