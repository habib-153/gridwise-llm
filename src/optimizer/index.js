import { buildModel } from "./buildModel.js";
import { solveModel } from "./solve.js";
import { toHourlyPlan } from "./toHourlyPlan.js";

/**
 * Runs the full optimization step against already hour-sorted (0..23) input:
 * builds the LP model with directives applied, solves it, and converts the
 * solution into the final hourly_plan + totals.
 */
export function optimizeSchedule(sortedHours, battery, directiveInterpretation) {
  const model = buildModel(sortedHours, battery, directiveInterpretation);
  const result = solveModel(model);
  return toHourlyPlan(result, sortedHours, battery);
}
