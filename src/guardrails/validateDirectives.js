import { DIRECTIVE_TYPES } from "../utils/constants.js";

function cleanHours(hours) {
  if (!Array.isArray(hours)) return null;
  const set = new Set();
  for (const h of hours) {
    if (!Number.isInteger(h) || h < 0 || h > 23) return null;
    set.add(h);
  }
  if (set.size === 0) return null;
  return [...set].sort((a, b) => a - b);
}

function isFiniteNonNegative(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function noOpEntry(noteIndex, explanation) {
  return {
    note_index: noteIndex,
    applies: false,
    directive_type: "no_op",
    structured_adjustment: null,
    explanation: explanation || "This note does not affect today's energy schedule.",
  };
}

/**
 * Converts one raw LLM entry into an exact, schema-valid directive_interpretation
 * entry. Never throws — any violation degrades that single note to no_op, per
 * the safe-failure policy in docs/06-DECISIONS-LOG.md.
 */
function sanitizeEntry(noteIndex, raw, battery) {
  if (!raw || typeof raw !== "object") {
    return noOpEntry(noteIndex);
  }

  const directiveType = raw.directive_type;
  if (!DIRECTIVE_TYPES.includes(directiveType) || directiveType === "no_op") {
    return noOpEntry(noteIndex, raw.explanation);
  }

  const explanation =
    typeof raw.explanation === "string" && raw.explanation.trim().length > 0
      ? raw.explanation
      : `Applies a ${directiveType} directive.`;

  if (directiveType === "solar_reduction") {
    const hours = cleanHours(raw.hours);
    const factor = raw.factor;
    if (!hours || typeof factor !== "number" || !Number.isFinite(factor) || factor < 0 || factor > 1) {
      return noOpEntry(noteIndex, raw.explanation);
    }
    return {
      note_index: noteIndex,
      applies: true,
      directive_type: "solar_reduction",
      structured_adjustment: { hours, factor },
      explanation,
    };
  }

  if (directiveType === "minimum_battery_reserve") {
    const hours = cleanHours(raw.hours);
    const minimumEnergyKwh = raw.minimum_energy_kwh;
    if (
      !hours ||
      !isFiniteNonNegative(minimumEnergyKwh) ||
      minimumEnergyKwh > battery.capacity_kwh
    ) {
      return noOpEntry(noteIndex, raw.explanation);
    }
    return {
      note_index: noteIndex,
      applies: true,
      directive_type: "minimum_battery_reserve",
      structured_adjustment: { hours, minimum_energy_kwh: minimumEnergyKwh },
      explanation,
    };
  }

  if (directiveType === "no_charge_window" || directiveType === "no_discharge_window") {
    const hours = cleanHours(raw.hours);
    if (!hours) {
      return noOpEntry(noteIndex, raw.explanation);
    }
    return {
      note_index: noteIndex,
      applies: true,
      directive_type: directiveType,
      structured_adjustment: { hours },
      explanation,
    };
  }

  if (directiveType === "max_grid_window") {
    const hours = cleanHours(raw.hours);
    const maxGridKwh = raw.max_grid_kwh;
    if (!hours || !isFiniteNonNegative(maxGridKwh)) {
      return noOpEntry(noteIndex, raw.explanation);
    }
    return {
      note_index: noteIndex,
      applies: true,
      directive_type: "max_grid_window",
      structured_adjustment: { hours, max_grid_kwh: maxGridKwh },
      explanation,
    };
  }

  return noOpEntry(noteIndex, raw.explanation);
}

/**
 * Builds the exact directive_interpretation array: one entry per note, in
 * note_index order, repairing missing/duplicate/out-of-range mappings from
 * the LLM by falling back to no_op rather than ever throwing.
 */
export function validateDirectives(rawEntries, operatorNotes, battery) {
  const byIndex = new Map();
  if (Array.isArray(rawEntries)) {
    for (const raw of rawEntries) {
      const idx = raw && Number.isInteger(raw.note_index) ? raw.note_index : null;
      if (idx !== null && idx >= 0 && idx < operatorNotes.length && !byIndex.has(idx)) {
        byIndex.set(idx, raw);
      }
    }
  }

  const result = [];
  for (let i = 0; i < operatorNotes.length; i++) {
    const raw = byIndex.get(i);
    result.push(sanitizeEntry(i, raw, battery));
  }
  return result;
}
