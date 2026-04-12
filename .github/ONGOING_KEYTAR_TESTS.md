Keytar Unit Tests Added (plan & record)

Summary
-------
Added a new unit test that injects a MockKeytar into AuthService to verify save/load
behavior without requiring the native keytar module in CI.

What changed
------------
- src/services/auth.service.ts: constructor now accepts an optional keytar override (used by tests).
- test/auth.service.keytar.test.ts: new test using an in-memory MockKeytar to validate token persistence.

Next steps
----------
1. (Optional) Run `bun test` locally to verify the new test passes.
2. Extend mock to cover additional keytar APIs as needed.

This test is intended to keep CI lightweight by avoiding native keytar dependency.
