import test from "node:test";
import assert from "node:assert/strict";

const {
  createEmptyToolRun,
  applyToolStarted,
  applyToolOutput,
  applyToolFinished,
} = await import("../src/features/assistant/controller.ts");

test("assistant controller 能按事件顺序归并 tool run 的开始、输出和结束状态", () => {
  let runs = [createEmptyToolRun("call-1")];

  runs = applyToolStarted(runs, {
    callId: "call-1",
    command: "rg ontology",
    cwd: "D:/code/FJY",
    startedAt: "2026-04-16T10:00:00.000Z",
  });
  runs = applyToolOutput(runs, {
    callId: "call-1",
    command: "rg ontology",
    stream: "stdout",
    chunk: "match-1\n",
    cwd: "D:/code/FJY",
    startedAt: "2026-04-16T10:00:00.000Z",
  });
  runs = applyToolOutput(runs, {
    callId: "call-1",
    command: "rg ontology",
    stream: "stderr",
    chunk: "warn-1\n",
    cwd: "D:/code/FJY",
    startedAt: "2026-04-16T10:00:00.000Z",
  });
  runs = applyToolFinished(runs, {
    callId: "call-1",
    command: "rg ontology",
    status: "success",
    stdout: "",
    stderr: "",
    exitCode: 0,
    cwd: "D:/code/FJY",
    durationMs: 88,
    startedAt: "2026-04-16T10:00:00.000Z",
    finishedAt: "2026-04-16T10:00:00.088Z",
  });

  assert.equal(runs[0].status, "success");
  assert.equal(runs[0].command, "rg ontology");
  assert.equal(runs[0].stdout, "match-1\n");
  assert.equal(runs[0].stderr, "warn-1\n");
  assert.equal(runs[0].durationMs, 88);
  assert.equal(runs[0].finishedAt, "2026-04-16T10:00:00.088Z");
});
