import solver from "javascript-lp-solver";

/**
 * Solves the LP model. Throws only for a truly infeasible model — per the
 * Problem Statement, organizer-valid scenarios are always feasible, so an
 * infeasible result here means a bug in our own model construction, and
 * should surface as a controlled 500 rather than a silently wrong plan.
 */
export function solveModel(model) {
  const result = solver.Solve(model);
  if (!result.feasible) {
    throw new Error("LP model infeasible — check directive translation / battery bounds");
  }
  return result;
}
