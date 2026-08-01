# Global Performance Isolation Verification

## Automated tests

- Backend: 94/94 passed.
- Frontend: 66/66 passed.
- Total: 160/160 passed.

## Static and release checks

- Security package audit: passed.
- Project doctor: passed.
- Regression guard: passed.
- Production regression audit: passed.
- Phase 9 frontend/UX verification: passed.
- Phase 8 release static verification: passed.
- JavaScript syntax checks: 124 files passed.
- JSX/TSX parser checks: 16 files passed.
- JSON parsing: 6 files passed.
- Relative source imports: 138 resolved.
- API routes: 81 unique routes.
- Test names: 160 unique tests.
- Package and lockfile versions: consistent.
- Merge-conflict and runtime-artifact scans: passed.

## Synthetic whole-workspace benchmark

The benchmark used 20,000 files, 10,000 performance records, 5,000 chat messages, 5,000 notifications and 5,000 audit records while changing one task row.

- Initial canonical cached hash: approximately 287 ms.
- Next hash after changing one collection: approximately 44 ms.
- Selected relational write preparation: approximately 1.5 ms.
- Cached hash matched the independent canonical hash.
- Unrelated file, performance, chat and notification collections retained their references.

Timing varies by hardware and workload. The benchmark verifies isolation behaviour rather than promising a fixed production latency.

## Environment-limited gates

A clean dependency installation and dependency-backed production build/live-server verification could not run in the repair environment because its internal npm mirror returned HTTP 404 for `zod-validation-error-4.0.2.tgz`. Clean `npm ci`, Vite production build, backend startup, PostgreSQL integration verification and public health checks remain mandatory stop-on-error deployment-host gates.
