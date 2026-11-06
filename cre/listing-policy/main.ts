// Workflow entry point (workflow.yaml `workflow-path`). Javy only allows parameterless exports here, so the
// handlers live in workflow.ts, where the tests import them from.
import { runWorkflow } from "./workflow";

export async function main() {
  await runWorkflow();
}
