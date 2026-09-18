import { applyDirectives } from "./applyDirectives.js";

const HOURS_N = 24;

// Tiny per-kWh penalty on battery throughput. Breaks LP degeneracy that would
// otherwise let the solver pick a vertex with simultaneous nonzero charge AND
// discharge in the same hour (mathematically valid for the balance equation
// since they cancel, but toHourlyPlan.js records only one action per hour,
// which would silently drop the other and break the balance in the output).
// Negligible next to real tariffs (5-30+ BDT/kWh) so it never changes the
// true grid-cost-optimal decision, and reported totals are recomputed from
// grid_kwh directly (see toHourlyPlan.js), so this term never leaks into them.
const THROUGHPUT_REGULARIZATION = 1e-6;

/**
 * Builds a javascript-lp-solver model for the 24-hour scenario.
 *
 * Variables per hour h: grid_h, solar_h, charge_h, discharge_h (all >= 0
 * implicitly, per the library's default variable semantics).
 *
 * Battery energy is NOT modeled as its own variable — battery_energy_after[h]
 * is algebraically initial_energy_kwh + sum_{k<=h}(charge_k - discharge_k), so
 * bounds and end-of-day neutrality are expressed as cumulative linear
 * constraints directly over charge/discharge. This keeps the model small and
 * lets us recompute the exact battery trajectory deterministically afterward
 * instead of trusting solver-internal intermediate values.
 */
export function buildModel(sortedHours, battery, directiveInterpretation) {
  const { effectiveSolar, chargeCap, dischargeCap, activeMin, maxGrid } = applyDirectives(
    sortedHours,
    battery,
    directiveInterpretation
  );

  const variables = {};
  const constraints = {};

  const gridVar = (h) => `grid_${h}`;
  const solarVar = (h) => `solar_${h}`;
  const chargeVar = (h) => `charge_${h}`;
  const dischargeVar = (h) => `discharge_${h}`;

  const ensureVar = (name) => {
    if (!variables[name]) variables[name] = {};
    return variables[name];
  };
  const addCoef = (varName, constraintName, coef) => {
    ensureVar(varName)[constraintName] = coef;
  };

  for (let h = 0; h < HOURS_N; h++) {
    const demand = sortedHours[h].demand_kwh;
    const tariff = sortedHours[h].tariff_bdt_per_kwh;

    // Objective: minimize total cost = sum(grid_h * tariff_h), plus a tiny
    // throughput penalty (see THROUGHPUT_REGULARIZATION comment above).
    addCoef(gridVar(h), "cost", tariff);
    addCoef(chargeVar(h), "cost", THROUGHPUT_REGULARIZATION);
    addCoef(dischargeVar(h), "cost", THROUGHPUT_REGULARIZATION);

    // Energy balance: grid + solar + discharge - charge = demand
    const balanceName = `balance_${h}`;
    constraints[balanceName] = { equal: demand };
    addCoef(gridVar(h), balanceName, 1);
    addCoef(solarVar(h), balanceName, 1);
    addCoef(dischargeVar(h), balanceName, 1);
    addCoef(chargeVar(h), balanceName, -1);

    // Solar usage cap
    constraints[`solarMax_${h}`] = { max: effectiveSolar[h] };
    addCoef(solarVar(h), `solarMax_${h}`, 1);

    // Charge / discharge rate caps (0 when a no_charge/no_discharge window is active)
    constraints[`chargeMax_${h}`] = { max: chargeCap[h] };
    addCoef(chargeVar(h), `chargeMax_${h}`, 1);

    constraints[`dischargeMax_${h}`] = { max: dischargeCap[h] };
    addCoef(dischargeVar(h), `dischargeMax_${h}`, 1);

    // Grid import cap (only meaningfully restrictive when a max_grid_window is active)
    if (Number.isFinite(maxGrid[h])) {
      constraints[`gridMax_${h}`] = { max: maxGrid[h] };
      addCoef(gridVar(h), `gridMax_${h}`, 1);
    }

    // Battery bounds at hour h: activeMin[h] <= initial + sum_{k<=h}(charge_k - discharge_k) <= capacity
    const boundsName = `batteryBounds_${h}`;
    constraints[boundsName] = {
      min: activeMin[h] - battery.initial_energy_kwh,
      max: battery.capacity_kwh - battery.initial_energy_kwh,
    };
    for (let k = 0; k <= h; k++) {
      addCoef(chargeVar(k), boundsName, 1);
      addCoef(dischargeVar(k), boundsName, -1);
    }
  }

  // End-of-day neutrality: sum_{k=0..23}(charge_k - discharge_k) = 0
  constraints["neutrality"] = { equal: 0 };
  for (let k = 0; k < HOURS_N; k++) {
    addCoef(chargeVar(k), "neutrality", 1);
    addCoef(dischargeVar(k), "neutrality", -1);
  }

  return {
    optimize: "cost",
    opType: "min",
    constraints,
    variables,
  };
}
