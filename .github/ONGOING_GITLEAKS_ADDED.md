Gitleaks CI workflow added
=========================

I added a gitleaks-based secret scanning GitHub Action at .github/workflows/gitleaks.yml.
This job runs on pushes and pull requests to master/main and will scan the repository history and files
for common secret patterns using the community gitleaks action.

Note: gitleaks may generate false positives; tune rules in CI if needed. This is complementary to the
purge workflow preparedness implemented earlier.
