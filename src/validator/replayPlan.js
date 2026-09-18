import { applyDirectives } from "../optimizer/applyDirectives.js";

const TOLERANCE = 0.01;

function approxLte(a, b, tol = TOLERANCE) {
  return a <= b + tol;
}
function approxEq(a, b, tol = TOLERANCE) {
  return Math.abs(a - b) <= tol;
}

/**
 * Replays our own hourly_plan against the applied directives and the base
 * GridWise rules — the same checks the judge harness will run on us.
 * Returns { ok: true } or { ok: false, errors: [...] }. Never throws.
 * This exists purely to catch our own bugs before the judge does.
 */
export function replayPlan(sortedHours, battery, directiveInterpretation, hourlyPlan) {
  const errors = [];
  const { effectiveSolar, chargeCap, dischargeCap, activeMin, maxGrid } = applyDirectives(
    sortedHours,
    battery,
    directiveInterpretation
  );

  if (hourlyPlan.length !== 24) {
    return { ok: false, errors: ["hourly_plan must have exactly 24 entries"] };
  }

  let energy = battery.initial_energy_kwh;

  for (let h = 0; h < 24; h++) {
    const entry = hourlyPlan[h];
    if (!entry || entry.hour !== h) {
      errors.push(`hourly_plan[${h}] missing or out of order`);
      continue;
    }

    const { grid_kwh, solar_used_kwh, battery_action, battery_kwh } = entry;
    const demand = sortedHours[h].demand_kwh;

    if (grid_kwh < -TOLERANCE) errors.push(`hour ${h}: negative grid_kwh`);
    if (solar_used_kwh < -TOLERANCE) errors.push(`hour ${h}: negative solar_used_kwh`);
    if (!approxLte(solar_used_kwh, effectiveSolar[h])) {
      errors.push(`hour ${h}: solar_used_kwh exceeds effective solar`);
    }

    let charge = 0;
    let discharge = 0;
    if (battery_action === "charge") {
      charge = battery_kwh;
      if (!approxLte(charge, chargeCap[h])) errors.push(`hour ${h}: charge exceeds cap (no_charge_window?)`);
    } else if (battery_action === "discharge") {
      discharge = battery_kwh;
      if (!approxLte(discharge, dischargeCap[h])) {
        errors.push(`hour ${h}: discharge exceeds cap (no_discharge_window?)`);
      }
    } else if (battery_action === "idle") {
      if (Math.abs(battery_kwh) > TOLERANCE) errors.push(`hour ${h}: idle must have battery_kwh 0`);
    } else {
      errors.push(`hour ${h}: invalid battery_action "${battery_action}"`);
    }

    // Energy balance: grid + solar_used + discharge == demand + charge
    const balance = grid_kwh + solar_used_kwh + discharge - demand - charge;
    if (!approxEq(balance, 0)) errors.push(`hour ${h}: energy balance violated`);

    // Grid cap directive
    if (Number.isFinite(maxGrid[h]) && !approxLte(grid_kwh, maxGrid[h])) {
      errors.push(`hour ${h}: grid_kwh exceeds max_grid_window cap`);
    }

    energy += charge - discharge;

    if (energy < activeMin[h] - TOLERANCE || energy > battery.capacity_kwh + TOLERANCE) {
      errors.push(`hour ${h}: battery_energy_after out of bounds`);
    }
    if (!approxEq(entry.battery_energy_after_kwh, energy)) {
      errors.push(`hour ${h}: battery_energy_after_kwh does not match replayed trajectory`);
    }
  }

  if (!approxEq(energy, battery.initial_energy_kwh)) {
    errors.push("end-of-day battery neutrality violated");
  }

  return { ok: errors.length === 0, errors };
}
