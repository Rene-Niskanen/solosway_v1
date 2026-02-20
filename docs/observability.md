# Observability

How to inspect request timing, graph step duration, and LLM/graph execution traces.

## Request timing

Every HTTP request is timed at the Flask app level:

- **before_request:** Records start time and a short `request_id` on `g`.
- **after_request:** Logs one line: `[PERF] METHOD path STATUS elapsed_ms request_id=...`

For streaming responses (`/api/llm/query/stream`), the app-level log reflects time until the `Response` object is returned (time to first byte). Full stream duration is logged when the stream finishes: `[PERF][STREAM]` with `timing` and optional `request_id` for correlation.

## LangGraph step logging

Main graph nodes log start and duration so you can see which steps are slow:

- **Format:** `[PERF] Node <name> started` and `[PERF] Node <name> finished in X.XXs`
- **Nodes instrumented:** context_manager, conversation, planner, executor, evaluator, responder, agent

On node error you get: `[PERF] Node <name> finished in X.XXs (error: ...)` before the exception is re-raised.

The stream path in `backend/views.py` also logs slow nodes (>1s) from the event stream and emits a full timing breakdown at the end of each stream.

## LangSmith tracing

To send LLM and LangGraph traces to [LangSmith](https://smith.langchain.com) for inspection (latency, token usage, graph steps):

1. **Get an API key:** Sign in at https://smith.langchain.com and create an API key in settings.
2. **Set environment variables** (e.g. in `.env`):
   - `LANGCHAIN_TRACING_V2=true`
   - `LANGCHAIN_API_KEY=<your-langsmith-api-key>`
   - `LANGCHAIN_PROJECT=velora` (optional; groups runs in the LangSmith UI)
3. Restart the backend. On startup you should see: `LangSmith tracing enabled (project: velora)`.

The codebase also accepts `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, and `LANGSMITH_PROJECT`; these are mapped to the `LANGCHAIN_*` names if the latter are not set.

**EU region:** If you use **eu.smith.langchain.com** (EU LangSmith), add to `.env` so traces go to the EU API:
- `LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com`
Without this, traces are sent to the default US endpoint and will not appear in your EU project.

Traces include LLM calls, tool usage, and graph node execution for the stream and other LangChain/LangGraph usage.
