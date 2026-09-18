import { EPSILON } from "../utils/constants.js";

function getVar(result, name) {
  // javascript-lp-solver omits any variable whose solved value is exactly 0
  // from the result object entirely — missing means 0, not "unset".
  const v = result[name];
  return typeof v === "number" ? v : 0;
}

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function snap(x) {
  return Math.abs(x) < EPSILON ? 0 : x;
}

/**
 * Converts the raw LP solution into the exact hourly_plan response shape,
 * recomputing battery_energy_after cumulatively ourselves (never trusting
 * any solver-internal battery-energy value, since none was modeled as a
 * variable in the first place) and recomputing totals from this same
 * rounded plan so they can never drift from hourly_plan by more than the
 * 0.01 tolerance.
 */
export function toHourlyPlan(result, sortedHours, battery) {
  const hourlyPlan = [];
  let energy = battery.initial_energy_kwh;
  let totalGrid = 0;
  let totalCost = 0;
  let peakGrid = 0;

  for (let h = 0; h < 24; h++) {
    const grid = round2(snap(getVar(result, `grid_${h}`)));
    const solarUsed = round2(snap(getVar(result, `solar_${h}`)));
    const charge = snap(getVar(result, `charge_${h}`));
    const discharge = snap(getVar(result, `discharge_${h}`));

    // Net the two directly rather than trusting the solver to never assign
    // both simultaneously (it's a mathematically valid degenerate vertex of
    // the LP relaxation — they'd cancel — but our output can only report one
    // action per hour). Net(discharge - charge) preserves the exact energy
    // balance the solver satisfied: grid + solar + discharge - charge = demand
    // reduces to grid + solar + net = demand either way. The
    // THROUGHPUT_REGULARIZATION term in buildModel.js keeps this from
    // triggering in the first place; this is the belt-and-suspenders backstop.
    const net = discharge - charge;
    let batteryAction = "idle";
    let batteryKwh = 0;
    if (net > EPSILON) {
      batteryAction = "discharge";
      batteryKwh = round2(net);
      energy -= net;
    } else if (net < -EPSILON) {
      batteryAction = "charge";
      batteryKwh = round2(-net);
      energy += -net;
    }

    const batteryEnergyAfter = round2(energy);

    hourlyPlan.push({
      hour: h,
      grid_kwh: grid,
      solar_used_kwh: solarUsed,
      battery_action: batteryAction,
      battery_kwh: batteryKwh,
      battery_energy_after_kwh: batteryEnergyAfter,
    });

    totalGrid += grid;
    totalCost += grid * sortedHours[h].tariff_bdt_per_kwh;
    if (grid > peakGrid) peakGrid = grid;
  }

  return {
    hourlyPlan,
    totalGridKwh: round2(totalGrid),
    totalCostBdt: round2(totalCost),
    peakGridKwh: round2(peakGrid),
  };
}
