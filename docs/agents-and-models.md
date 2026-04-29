# Agents and Model Providers

## Do We Need Agents?

Yes, but they should be narrow pipeline agents, not autonomous chatbots.

For this project, "agentic" means each stage owns a specific decision and emits structured output for the next stage. That keeps the demo explainable and avoids making the LLM responsible for facts.

## Current Agents

| Agent | File | Role | LLM? |
|---|---|---|---|
| Ingest Agent | `src/phantom_flow/agents.py` | Load grants, normalize names, aggregate recipients | No |
| Corporate Match Agent | `src/phantom_flow/agents.py` | Match recipients to corporation records with confidence | No |
| Risk Scoring Agent | `src/phantom_flow/agents.py` | Compute zombie flags, score breakdown, recommendation | No |
| Case Writing Agent | `src/phantom_flow/agents.py` | Turn verified facts into concise case summaries | Optional |

The LLM only writes summaries from structured evidence. It does not decide whether an entity is a zombie and does not calculate the score.

## Provider Strategy

Use Groq for testing because it is fast and OpenAI-compatible.

Use Gemini or Claude for final/demo summaries:
- Gemini is useful when we want fast, inexpensive production summaries through an OpenAI-compatible endpoint.
- Claude is useful when we want the strongest briefing-note quality and careful caveats.

## Environment Variables

```powershell
PHANTOM_FLOW_LLM_PROVIDER=template
PHANTOM_FLOW_LLM_CASE_LIMIT=0

GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
```

## Commands

Deterministic local build:

```powershell
$env:PYTHONPATH="src"
python -m phantom_flow.pipeline
```

Groq test run for top 5 cases:

```powershell
$env:PYTHONPATH="src"
$env:PHANTOM_FLOW_LLM_PROVIDER="groq"
$env:GROQ_API_KEY="..."
python -m phantom_flow.pipeline --llm-provider groq --llm-limit 5
```

Gemini run for top 10 cases:

```powershell
$env:PYTHONPATH="src"
$env:GEMINI_API_KEY="..."
python -m phantom_flow.pipeline --llm-provider gemini --llm-limit 10
```

Claude run for top 10 cases:

```powershell
$env:PYTHONPATH="src"
$env:ANTHROPIC_API_KEY="..."
python -m phantom_flow.pipeline --llm-provider claude --llm-limit 10
```

## Why This Architecture Wins

- The app can run without any API key.
- The scored queue is reproducible.
- LLM output is limited to narrative explanation.
- Each LLM summary stores provider and model metadata in `results.json`.
- Judges can inspect the evidence and scoring math behind every case.
