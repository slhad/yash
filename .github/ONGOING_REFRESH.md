AuthService Auto-Refresh Wired (record)

Summary
-------
Wired AuthService background token auto-refresh into application initialization.
The AuthService is instantiated in src/index.ts and startAutoRefresh(...) is invoked
after initial provider authentication.

What changed
------------
- src/index.ts: created authService instance and started auto-refresh with a 60s interval.

Why
---
This enables automatic refresh of expiring tokens using the provider.authenticate() fallback
behavior implemented by individual providers. It reduces token expiry surprises during long runs.

Notes
-----
- AuthService already supports OS keyring (keytar) optionally. For full keyring-backed
  behavior, follow the keyring migration plan in .github/ONGOING_KEYRING.md.
- No destructive actions taken. This is a small, low-risk wiring change.
