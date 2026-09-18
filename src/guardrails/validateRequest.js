function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validates the raw POST /optimize-energy request body against the
 * Problem Statement §07 request schema. Returns { ok: true, errors: [] }
 * or { ok: false, errors: [...] }. Never throws.
 */
export function validateRequest(body) {
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["request body must be a JSON object"] };
  }

  if (typeof body.scenario_id !== "string" || body.scenario_id.length === 0) {
    errors.push("scenario_id must be a non-empty string");
  }

  if (
    !Array.isArray(body.operator_notes) ||
    body.operator_notes.length < 1 ||
    body.operator_notes.length > 3 ||
    !body.operator_notes.every((n) => typeof n === "string" && n.trim().length > 0)
  ) {
    errors.push("operator_notes must be an array of 1-3 non-empty strings");
  }

  if (!Array.isArray(body.hours) || body.hours.length !== 24) {
    errors.push("hours must be an array of exactly 24 entries");
  } else {
    const seenHours = new Set();
    for (const [idx, h] of body.hours.entries()) {
      if (!h || typeof h !== "object") {
        errors.push(`hours[${idx}] must be an object`);
        continue;
      }
      if (!Number.isInteger(h.hour) || h.hour < 0 || h.hour > 23) {
        errors.push(`hours[${idx}].hour must be an integer 0-23`);
      } else if (seenHours.has(h.hour)) {
        errors.push(`hours[${idx}].hour duplicates hour ${h.hour}`);
      } else {
        seenHours.add(h.hour);
      }
      if (!isFiniteNumber(h.demand_kwh) || h.demand_kwh < 0) {
        errors.push(`hours[${idx}].demand_kwh must be a non-negative finite number`);
      }
      if (!isFiniteNumber(h.solar_kwh) || h.solar_kwh < 0) {
        errors.push(`hours[${idx}].solar_kwh must be a non-negative finite number`);
      }
      if (!isFiniteNumber(h.tariff_bdt_per_kwh) || h.tariff_bdt_per_kwh < 0) {
        errors.push(`hours[${idx}].tariff_bdt_per_kwh must be a non-negative finite number`);
      }
    }
    if (Array.isArray(body.hours) && body.hours.length === 24 && seenHours.size !== 24) {
      errors.push("hours must cover each hour 0-23 exactly once");
    }
  }

  const battery = body.battery;
  if (!battery || typeof battery !== "object") {
    errors.push("battery must be an object");
  } else {
    for (const field of [
      "capacity_kwh",
      "initial_energy_kwh",
      "minimum_energy_kwh",
      "max_charge_kwh_per_hour",
      "max_discharge_kwh_per_hour",
    ]) {
      if (!isFiniteNumber(battery[field]) || battery[field] < 0) {
        errors.push(`battery.${field} must be a non-negative finite number`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
