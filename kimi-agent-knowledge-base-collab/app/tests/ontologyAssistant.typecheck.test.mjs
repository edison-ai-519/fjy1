import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execSync } from "node:child_process";

test("OntologyAssistant 相关组件可以通过独立类型检查", () => {
  const appRoot = "D:/code/FJY/kimi-agent-knowledge-base-collab/app";
  const configPath = path.join(appRoot, "tests/tsconfig.ontologyAssistant.json");
  const tscPath = path.join(appRoot, "node_modules/.bin/tsc.cmd");
  const command = `cmd /d /s /c ""${tscPath}" -p "${configPath}" --pretty false"`;

  assert.doesNotThrow(() => {
    execSync(command, {
      cwd: appRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  });
});
