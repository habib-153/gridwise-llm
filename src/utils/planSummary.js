/**
 * Cheap deterministic summary of which directives were applied. Cosmetic
 * only — does NOT satisfy the LLM requirement (see Problem Statement §02);
 * the LLM's real job is directive_interpretation, done upstream of this.
 */
export function buildPlanSummary(directiveInterpretation) {
  const applied = directiveInterpretation.filter((d) => d.applies);
  if (applied.length === 0) {
    return "No operator directives applied; schedule optimized against base demand, solar, and tariff to minimize grid cost while respecting battery limits and end-of-day neutrality.";
  }
  const parts = applied.map((d) => d.directive_type.replace(/_/g, " "));
  return `Applied ${parts.join(", ")} while minimizing total grid cost and respecting battery limits and end-of-day neutrality.`;
}
