/**
 * Turns the validated directive_interpretation array into per-hour effective
 * limits the LP model can consume directly. Combines overlapping same-type
 * directives conservatively (multiple notes are expected to be rare/non-
 * overlapping per the Problem Statement's feasibility guarantee, but this
 * degrades safely if they do overlap).
 */
export function applyDirectives(hours, battery, directiveInterpretation) {
  const n = 24;
  const solarMultiplier = new Array(n).fill(1);
  const chargeBlocked = new Array(n).fill(false);
  const dischargeBlocked = new Array(n).fill(false);
  const activeMin = new Array(n).fill(battery.minimum_energy_kwh);
  const maxGrid = new Array(n).fill(Infinity);

  for (const entry of directiveInterpretation) {
    if (!entry.applies) continue;
    const adj = entry.structured_adjustment;
    if (!adj || !Array.isArray(adj.hours)) continue;

    switch (entry.directive_type) {
      case "solar_reduction":
        for (const h of adj.hours) solarMultiplier[h] *= adj.factor;
        break;
      case "minimum_battery_reserve":
        for (const h of adj.hours) {
          activeMin[h] = Math.max(activeMin[h], adj.minimum_energy_kwh);
        }
        break;
      case "no_charge_window":
        for (const h of adj.hours) chargeBlocked[h] = true;
        break;
      case "no_discharge_window":
        for (const h of adj.hours) dischargeBlocked[h] = true;
        break;
      case "max_grid_window":
        for (const h of adj.hours) {
          maxGrid[h] = Math.min(maxGrid[h], adj.max_grid_kwh);
        }
        break;
      default:
        break;
    }
  }

  const effectiveSolar = hours.map((h, i) => h.solar_kwh * solarMultiplier[i]);
  const chargeCap = hours.map((_, i) => (chargeBlocked[i] ? 0 : battery.max_charge_kwh_per_hour));
  const dischargeCap = hours.map((_, i) =>
    dischargeBlocked[i] ? 0 : battery.max_discharge_kwh_per_hour
  );

  return { effectiveSolar, chargeCap, dischargeCap, activeMin, maxGrid };
}
