import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { replayPlan } from "../src/validator/replayPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080";
const TOLERANCE = 0.01;

function approxEq(a, b, tol = TOLERANCE) {
  return Math.abs(a - b) <= tol;
}

function sortHoursArr(hours) {
  return [...hours].sort((a, b) => a.hour - b.hour);
}

function sortNums(arr) {
  return [...arr].sort((a, b) => a - b);
}

function compareStructuredAdjustment(type, expected, actual) {
  if (type === "no_op") return true;
  if (!expected || !actual) return false;
  const eh = sortNums(expected.hours || []);
  const ah = sortNums(actual.hours || []);
  if (eh.length !== ah.length || eh.some((h, i) => h !== ah[i])) return false;
  if (type === "solar_reduction") return approxEq(expected.factor, actual.factor);
  if (type === "minimum_battery_reserve") {
    return approxEq(expected.minimum_energy_kwh, actual.minimum_energy_kwh);
  }
  if (type === "max_grid_window") return approxEq(expected.max_grid_kwh, actual.max_grid_kwh);
  return true; // no_charge_window / no_discharge_window: hours already compared
}

function recomputeTotals(hourlyPlan, sortedHours) {
  let grid = 0;
  let cost = 0;
  let peak = 0;
  for (let h = 0; h < 24; h++) {
    grid += hourlyPlan[h].grid_kwh;
    cost += hourlyPlan[h].grid_kwh * sortedHours[h].tariff_bdt_per_kwh;
    if (hourlyPlan[h].grid_kwh > peak) peak = hourlyPlan[h].grid_kwh;
  }
  return { grid, cost, peak };
}

async function runCase(testCase) {
  const { id, input, expected_output: expected } = testCase;
  const issues = [];

  let response;
  try {
    const res = await fetch(`${BASE_URL}/optimize-energy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status !== 200) {
      issues.push(`HTTP ${res.status} (expected 200)`);
      return { id, ok: false, issues };
    }
    response = await res.json();
  } catch (err) {
    issues.push(`request failed: ${err.message}`);
    return { id, ok: false, issues };
  }

  // --- Schema checks ---
  if (response.scenario_id !== input.scenario_id) issues.push("scenario_id mismatch");
  if (
    !Array.isArray(response.directive_interpretation) ||
    response.directive_interpretation.length !== input.operator_notes.length
  ) {
    issues.push("directive_interpretation length mismatch");
  } else {
    response.directive_interpretation.forEach((entry, i) => {
      if (entry.note_index !== i) issues.push(`directive_interpretation[${i}].note_index !== ${i}`);
    });
  }
  if (!Array.isArray(response.hourly_plan) || response.hourly_plan.length !== 24) {
    issues.push("hourly_plan must have exactly 24 entries");
  }

  // --- Interpretation match vs expected ground truth ---
  if (Array.isArray(response.directive_interpretation)) {
    for (const expEntry of expected.directive_interpretation) {
      const actEntry = response.directive_interpretation[expEntry.note_index];
      if (!actEntry) continue;
      if (actEntry.directive_type !== expEntry.directive_type) {
        issues.push(
          `note ${expEntry.note_index}: directive_type expected "${expEntry.directive_type}", got "${actEntry.directive_type}"`
        );
      } else if (
        !compareStructuredAdjustment(
          expEntry.directive_type,
          expEntry.structured_adjustment,
          actEntry.structured_adjustment
        )
      ) {
        issues.push(`note ${expEntry.note_index}: structured_adjustment mismatch`);
      }
      if (actEntry.applies !== expEntry.applies) {
        issues.push(`note ${expEntry.note_index}: applies expected ${expEntry.applies}, got ${actEntry.applies}`);
      }
    }
  }

  // --- Directive application + base validity, replayed against GROUND-TRUTH directives ---
  if (Array.isArray(response.hourly_plan) && response.hourly_plan.length === 24) {
    const sortedHours = sortHoursArr(input.hours);
    const replay = replayPlan(
      sortedHours,
      input.battery,
      expected.directive_interpretation,
      response.hourly_plan
    );
    if (!replay.ok) {
      issues.push(...replay.errors.map((e) => `ground-truth replay: ${e}`));
    }

    // --- Totals consistency ---
    const recomputed = recomputeTotals(response.hourly_plan, sortedHours);
    if (!approxEq(recomputed.grid, response.total_grid_kwh)) {
      issues.push(`total_grid_kwh mismatch: reported ${response.total_grid_kwh}, recomputed ${recomputed.grid}`);
    }
    if (!approxEq(recomputed.cost, response.total_cost_bdt)) {
      issues.push(`total_cost_bdt mismatch: reported ${response.total_cost_bdt}, recomputed ${recomputed.cost}`);
    }
    if (!approxEq(recomputed.peak, response.peak_grid_kwh)) {
      issues.push(`peak_grid_kwh mismatch: reported ${response.peak_grid_kwh}, recomputed ${recomputed.peak}`);
    }

    // --- Cost quality vs reference optimum ---
    if (response.total_cost_bdt > expected.total_cost_bdt + TOLERANCE) {
      issues.push(
        `cost quality: got ${response.total_cost_bdt}, reference optimum ${expected.total_cost_bdt} (worse)`
      );
    }
  }

  return { id, ok: issues.length === 0, issues };
}

async function main() {
  const fixturesPath = path.join(__dirname, "..", "test", "fixtures", "sample-cases.json");
  const data = JSON.parse(readFileSync(fixturesPath, "utf8"));

  console.log(`Running ${data.cases.length} sample cases against ${BASE_URL} ...\n`);

  let allOk = true;
  for (const testCase of data.cases) {
    const result = await runCase(testCase);
    allOk = allOk && result.ok;
    if (result.ok) {
      console.log(`PASS  ${result.id}`);
    } else {
      console.log(`FAIL  ${result.id}`);
      for (const issue of result.issues) console.log(`      - ${issue}`);
    }
  }

  console.log("\n" + (allOk ? "All sample cases passed." : "Some sample cases failed — see above."));
  process.exit(allOk ? 0 : 1);
}

main();
