Gitleaks CI Tuned (record)

Summary
-------
Added a basic `.gitleaks.toml` configuration to reduce false positives from tests, example
configs, and local tmp artifacts. Also updated CI workflow to run gitleaks as an early job.

What changed
------------
- Added `.gitleaks.toml` with allowlist paths: test/, config.example.json, tmp/, .github/
- Updated `.github/workflows/ci.yml` to run gitleaks (gitleaks-action) as an early blocking job.

Next steps
----------
1. Review `.gitleaks.toml` rules; tighten or broaden allowlists as required.
2. Monitor CI runs and adjust config to reduce noise while keeping coverage for real secrets.
