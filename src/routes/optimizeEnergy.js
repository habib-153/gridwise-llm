import { validateRequest } from "../guardrails/validateRequest.js";
import { validateDirectives } from "../guardrails/validateDirectives.js";
import { interpretOperatorNotes } from "../llm/interpret.js";
import { optimizeSchedule } from "../optimizer/index.js";
import { replayPlan } from "../validator/replayPlan.js";
import { buildPlanSummary } from "../utils/planSummary.js";

export async function optimizeEnergyHandler(req, res) {
  const body = req.body;

  const requestCheck = validateRequest(body);
  if (!requestCheck.ok) {
    return res.status(400).json({ error: "invalid_request", details: requestCheck.errors });
  }

  const sortedHours = [...body.hours].sort((a, b) => a.hour - b.hour);
  const battery = body.battery;

  let directiveInterpretation;
  try {
    const raw = await interpretOperatorNotes({
      operatorNotes: body.operator_notes,
      battery,
    });
    // raw === null means the LLM call failed or was unavailable; validateDirectives
    // safely degrades every note to no_op in that case rather than crashing.
    directiveInterpretation = validateDirectives(raw, body.operator_notes, battery);
  } catch (err) {
    console.error("Interpretation stage failed:", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }

  let optimized;
  try {
    optimized = optimizeSchedule(sortedHours, battery, directiveInterpretation);
  } catch (err) {
    console.error("Optimization stage failed:", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }

  const replay = replayPlan(sortedHours, battery, directiveInterpretation, optimized.hourlyPlan);
  if (!replay.ok) {
    console.error("Self-validation failed:", replay.errors);
    return res.status(500).json({ error: "internal_error" });
  }

  return res.status(200).json({
    scenario_id: body.scenario_id,
    directive_interpretation: directiveInterpretation,
    hourly_plan: optimized.hourlyPlan,
    total_grid_kwh: optimized.totalGridKwh,
    total_cost_bdt: optimized.totalCostBdt,
    peak_grid_kwh: optimized.peakGridKwh,
    plan_summary: buildPlanSummary(directiveInterpretation),
  });
}
