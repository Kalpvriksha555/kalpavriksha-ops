# Phase 20 — Runtime Error Diagnostics & Self-Diagnosing Failure Closure

Phase 20 continues from the Phase 19 long-session baseline and closes the observability gap that made rare production failures depend on screenshots or raw browser messages. The goal is to make a future runtime/API failure correlatable and classifiable without storing employee names, business payloads, query strings, raw JavaScript error messages, or raw browser stacks in the client diagnostic event.

## Closed failure classes

- Every authenticated frontend request now carries a client-generated `X-Request-Id` when one is not already present, allowing browser and backend evidence to refer to the same failed request.
- HTTP failures, transport/timeout failures and API-contract failures carry safe request metadata (method, sanitized route, operation, response class and server error fingerprint) into the runtime diagnostic boundary.
- React error boundaries, global `error`, unhandled promise rejection and API diagnostic events use one bounded diagnostic service instead of independent raw-error stores.
- Client diagnostics are classified into stable classes such as `TYPE_NOT_FUNCTION`, `NULLISH_PROPERTY_ACCESS`, `REQUEST_TIMEOUT`, `NETWORK_UNAVAILABLE`, `CONFLICT` and `SERVER_5XX`.
- Client diagnostic routes remove query strings and redact numeric/UUID/business-like path identifiers. Operations redact API identifiers and quoted values.
- The browser stores at most 30 sanitized diagnostic records and no longer writes the previous raw `kalpa_last_error` / legacy chat stack logs.
- A diagnostic receives a stable `KD-...` ID and fingerprint that can be shown to a user/admin without exposing the underlying raw exception text.
- Authenticated pages can report sanitized diagnostics to `POST /api/client-diagnostics`. The endpoint is rate limited, duplicate-suppressed and whitelists accepted fields; unexpected fields such as raw `message`, `stack`, passwords or business payloads are ignored.
- Persisted client diagnostic operational events use role-only actor context and safe state/revision/browser metadata. If the operational event store is unavailable, a sanitized structured warning is emitted and the reporting request still terminates cleanly rather than entering a retry loop.
- Backend internal 5xx responses are centralized through `sendApiFailure`: clients receive a safe fallback message, request ID and `errorFingerprint`; raw internal exception messages remain server-side. Expected 4xx validation/authorization responses remain actionable.
- `X-Error-Fingerprint` is exposed through CORS so an approved cross-origin frontend can correlate a server-side 5xx without learning internal details.
- Structured request/event paths are sanitized before logging so query parameters and record identifiers are not copied into diagnostic paths.
- Command Centre Operational Events can display the safe diagnostic ID, class, source, operation, method/route, revision markers, viewport/visibility and component path for `CLIENT_RUNTIME_DIAGNOSTIC` events.

## Permanent release gate

`scripts/phase-20-runtime-error-diagnostics-check.mjs` is part of root `npm run verify` and the full release-verifier matrix. It enforces request correlation, bounded/sanitized client diagnostics, safe 5xx responses, the authenticated diagnostic sink, admin traceability, CORS fingerprint exposure and the absence of the legacy raw client error stores.

## Data-safety invariant

Phase 20 does not add automatic business-data collection to diagnostics. Raw runtime messages/stacks remain available only to the immediate in-process classifier/fingerprint calculation; the bounded client record and the server-persisted client diagnostic contain only the reviewed metadata whitelist. Existing finance, task, attendance, file and PostgreSQL retention rules are unchanged.
