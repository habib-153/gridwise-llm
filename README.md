# GridWise LLM — Campus Energy Optimization API

BUP CSE Fest 2026 Hackathon — Online Preliminary submission for the **Smart Campus Energy Optimization Challenge (LLM-Assisted Operator Directive Interpretation)**.

## What this is

A single HTTP API service that:
1. Reads 1–3 natural-language **operator notes** plus a 24-hour demand/solar/tariff/battery scenario.
2. Uses an **LLM (OpenAI, `gpt-4o-mini`)** to interpret every note into a structured directive (or `no_op`).
3. Runs that raw LLM output through a **deterministic guardrail validator** that enforces the exact schema, ranges, and safe-fallback rules — the LLM's output is never trusted directly.
4. Builds and solves a **Linear Program** (via `javascript-lp-solver`) that minimizes total grid electricity cost subject to the validated directives and the base GridWise energy/battery rules.
5. **Self-replays** the resulting plan against the same rules before responding, catching our own bugs before the judge does.
6. Returns the machine-checkable interpretation plus the final 24-hour schedule.

```
Energy Data + Operator Notes → LLM Interpreter → Guardrail Validator → LP Optimizer → Final Validator → API Response
```

## Endpoints

| Endpoint | Behavior |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `POST /optimize-energy` | Accepts one scenario JSON object, returns interpretation + optimized 24h schedule |

Full request/response schema: see the Problem Statement (canonical) — summarized in `docs/02-API-CONTRACT.md` in the planning workspace this repo was built from.

## Model / provider

- **Provider**: OpenAI, model `gpt-4o-mini` (overridable via `OPENAI_MODEL`).
- **LLM's exact role**: interprets `operator_notes` into a raw, flat, nullable-field JSON shape (`src/llm/schema.js`, `src/llm/prompt.js`) via OpenAI Structured Outputs (`response_format: json_schema, strict:true`). This raw output feeds directly into the guardrail validator and from there into the optimizer — it is **not** used only for cosmetic text.
- The LLM is asked to show its clock-time-to-24-hour conversion reasoning (`time_reasoning` field) before committing to an hours array — this measurably improved accuracy on boundary cases like "until 10 PM" during testing.

## Guardrails (deterministic, never trusts the LLM directly)

`src/guardrails/validateDirectives.js` reshapes and validates every raw LLM entry:
- `directive_type` must be one of the 6 supported types, else → `no_op`.
- `no_op` forces `applies:false` / `structured_adjustment:null`; every other type forces `applies:true`.
- `hours` must be unique integers 0–23; deduped and sorted; empty/invalid → `no_op`.
- `solar_reduction.factor` clamped to `[0,1]`; invalid → `no_op`.
- `minimum_battery_reserve.minimum_energy_kwh` must be finite, ≥0, ≤ battery capacity; invalid → `no_op`.
- `max_grid_window.max_grid_kwh` must be finite, ≥0; invalid → `no_op`.
- Missing/duplicate/out-of-range `note_index` mappings are repaired deterministically.
- **Never throws** — any violation degrades that single note to `no_op` rather than failing the whole request (a crash loses the entire case; a wrong `no_op` only loses that note's interpretation credit).

## Optimizer / solver

- **Library**: [`javascript-lp-solver`](https://github.com/JWally/jsLPSolver) — pure JS Simplex LP/MILP solver, no native dependencies.
- **Formulation**: continuous LP over `grid[h]`, `solar_used[h]`, `charge[h]`, `discharge[h]` for h=0..23, with energy balance, effective-solar cap, charge/discharge rate caps (zeroed under `no_charge_window`/`no_discharge_window`), a raised reserve floor under `minimum_battery_reserve`, a grid cap under `max_grid_window`, and end-of-day battery neutrality — all expressed as linear constraints. Objective: minimize `Σ grid[h] * tariff[h]`.
- Battery energy trajectory is **not** a solver variable — it's recomputed deterministically from the solved charge/discharge values, and response totals (`total_grid_kwh`, `total_cost_bdt`, `peak_grid_kwh`) are always recomputed from the final rounded `hourly_plan`, never trusted from the solver's internal objective.
- A tiny throughput regularization term prevents a known LP degeneracy (simultaneous nonzero charge+discharge in one hour); `toHourlyPlan.js` also nets the two directly as a second line of defense.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | yes | OpenAI API key used for operator-note interpretation |
| `OPENAI_MODEL` | no (default `gpt-4o-mini`) | Model name |
| `PORT` | no (default `8080`) | HTTP port the service listens on |

No secrets are committed to this repository. Copy `.env.example` to `.env` and fill in your own key.

## Run locally

```bash
npm install
cp .env.example .env   # then edit .env and set OPENAI_API_KEY
npm start               # listens on 0.0.0.0:${PORT:-8080}
```

Health check:
```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

Sample request (`operator_notes` paraphrased from the public sample pack):
```bash
curl -s -X POST http://localhost:8080/optimize-energy \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "DEMO-1",
    "operator_notes": ["Solar output will drop to about 20% from 1 PM to 3 PM."],
    "hours": [ /* 24 entries: {"hour":0..23,"demand_kwh":...,"solar_kwh":...,"tariff_bdt_per_kwh":...} */ ],
    "battery": {"capacity_kwh":200,"initial_energy_kwh":100,"minimum_energy_kwh":30,"max_charge_kwh_per_hour":50,"max_discharge_kwh_per_hour":50}
  }'
```

Run the full public-sample regression suite (10 worked cases, validates schema, interpretation, ground-truth directive application, base energy/battery validity, totals consistency, and cost quality):
```bash
npm run test:samples
# All sample cases passed.
```

## Run with Docker

Build locally:
```bash
docker build -t gridwise-llm .
docker run -p 8080:8080 -e OPENAI_API_KEY=sk-... gridwise-llm
curl http://localhost:8080/health
```

Or pull the pre-built fallback image (verified: builds, runs, and passes `/health` and `/optimize-energy` locally with no baked-in secrets):
```bash
docker pull ghcr.io/habib-153/gridwise-llm:latest
docker run -p 8080:8080 -e OPENAI_API_KEY=sk-... ghcr.io/habib-153/gridwise-llm:latest
curl http://localhost:8080/health
```
Digest: `sha256:d361a77dd361a8bb5e481792cfe423a541ce78934e9404d1572f854d0be6990b`. Exposed port: `8080`. **Note**: this GHCR package is private until the submission deadline (matching the repository's own visibility rule) — it is switched to public at the same time as the repository.

## Deployment

Deployed on **Render** as a Node web service (see `render.yaml` for the Blueprint: build command `npm ci --omit=dev`, start command `node src/server.js`, health check path `/health`). `OPENAI_API_KEY` is set via Render's environment variable dashboard, never committed.

Public endpoint: _fill in the live Render URL here before submitting_.

## Dependencies

- `express` — HTTP server
- `openai` — official OpenAI SDK
- `javascript-lp-solver` — LP solver
- `dotenv` — local env var loading

## Known limitations

- LLM calls have a 12s internal timeout to stay within the 30s per-request budget; on timeout/provider error, the service safely falls back to treating every note as `no_op` (a valid, base-rules-only schedule) rather than failing the request.
- The LP models each scenario independently per request (no caching across requests); at 24h × 4 variables this solves in single-digit milliseconds, so this has not been a latency concern in testing.
- `plan_summary` is generated by a cheap deterministic template, not a second LLM call — this is cosmetic text only and does not affect the LLM requirement, which is satisfied entirely by the operator-note interpretation step.

## Credits

Built with the OpenAI API, Express, and the `javascript-lp-solver` open-source LP library. Core architecture, prompt design, guardrail logic, and optimization formulation are original to this submission.
