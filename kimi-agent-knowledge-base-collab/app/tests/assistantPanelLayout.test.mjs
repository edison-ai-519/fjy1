import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("问答助手主内容区使用聊天区与执行流两栏布局", async () => {
  const appRoot = "D:/code/FJY/kimi-agent-knowledge-base-collab/app";
  const layoutModulePath = path.join(appRoot, "src/components/assistant/panelLayout.ts");
  const { ASSISTANT_PANEL_LAYOUT } = await import(pathToFileURL(layoutModulePath).href);

  assert.deepEqual(ASSISTANT_PANEL_LAYOUT, {
    chat: {
      defaultSize: 72,
      minSize: 42,
    },
    flow: {
      defaultSize: 28,
      minSize: 16,
    },
  });
});
