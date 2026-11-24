import { captureArtifact } from "@solidjs/diagnostics";

/**
 * Runs a scenario under `@solidjs/diagnostics` without the two checks that
 * measure wall-clock time: HOT_SCOPE_TIME (8ms per scope) and WASTED_RECOMPUTE
 * (2ms of unchanged recomputes). Both fail when the machine is busy (parallel
 * test files, garbage collection) rather than when the code changes. The other
 * checks, such as hot re-runs and unstable list identity, stay on.
 */
export const captureScenario = async <T>(
  run: () => T | Promise<T>,
  scenario: string
) =>
  await captureArtifact(run, {
    attribution: { hotTime: false, wastedRecompute: false },
    scenario,
  });
