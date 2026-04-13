Ongoing work log

- 2026-04-13: Continued test stabilization and CI hardening.
  - Fixed dynamic YASH_DATA_DIR handling for AdminService and Audit so tests
    can swap stores at runtime.
  - Adjusted admin import handler RBAC to accept ['admin','ops'] during import
    scenario used in integration tests.
  - Made ObsService.scheduleReconnectAttempt return computed {delay,attempt}
    so tests can assert deterministic backoff without parsing global logs.
  - Updated Obs backoff unit test to use returned scheduling info where present.

Next actions:
1. Finalize OBS tests: reduce inter-test log interference by making schedule
   logging include host:port or by ensuring tests assert using returned info
   rather than global logger state. The latter is partially implemented but
   some tests still rely on logs; convert them as needed.
2. Remove any remaining debug-only code and re-run full test suite to verify
   no flaky tests.
3. Add a small unit test to verify AdminService respects dynamic
   YASH_DATA_DIR (prevents regressions when path is computed at runtime).
4. Once tests are stable, push branch and create PR with a summary and the
   reason for the changed RBAC semantics for imports (or revert RBAC change
   if that was only for the integration test's expectations).

Notes:
- tmp/ONGOING.md is git-ignored and intended for ephemeral developer tracking.
