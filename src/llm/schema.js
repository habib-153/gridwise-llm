export const directiveInterpretationSchema = {
  type: "object",
  properties: {
    directive_interpretations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          note_index: { type: "integer" },
          time_reasoning: { type: "string" },
          applies: { type: "boolean" },
          directive_type: {
            type: "string",
            enum: [
              "solar_reduction",
              "minimum_battery_reserve",
              "no_charge_window",
              "no_discharge_window",
              "max_grid_window",
              "no_op",
            ],
          },
          hours: {
            type: ["array", "null"],
            items: { type: "integer" },
          },
          factor: { type: ["number", "null"] },
          minimum_energy_kwh: { type: ["number", "null"] },
          max_grid_kwh: { type: ["number", "null"] },
          explanation: { type: "string" },
        },
        required: [
          "note_index",
          "time_reasoning",
          "applies",
          "directive_type",
          "hours",
          "factor",
          "minimum_energy_kwh",
          "max_grid_kwh",
          "explanation",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["directive_interpretations"],
  additionalProperties: false,
};
