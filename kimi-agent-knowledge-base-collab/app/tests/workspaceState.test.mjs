import test from "node:test";
import assert from "node:assert/strict";

const {
  pickSelectedProjectId,
  pickSelectedFile,
  syncEditorStateFromContent,
} = await import("../src/features/workspace/state.ts");

test("workspace state 会优先保留当前仍存在的项目和文件选择", () => {
  const projects = [
    { id: "project-a", name: "项目 A" },
    { id: "project-b", name: "项目 B" },
  ];
  const timelines = [
    { filename: "engine.json", commits: [] },
    { filename: "sensor.json", commits: [] },
  ];

  assert.equal(pickSelectedProjectId(projects, "project-b"), "project-b");
  assert.equal(pickSelectedProjectId(projects, "missing"), "project-a");
  assert.equal(pickSelectedFile(timelines, "sensor.json"), "sensor.json");
  assert.equal(pickSelectedFile(timelines, "missing.json"), "engine.json");
});

test("workspace state 会把读取内容同步为编辑器默认文件名和格式化 JSON", () => {
  const next = syncEditorStateFromContent("engine.json", {
    name: "发动机",
    type: "component",
  });

  assert.equal(next.writeFilename, "engine.json");
  assert.equal(
    next.writeData,
    '{\n  "name": "发动机",\n  "type": "component"\n}',
  );
});
