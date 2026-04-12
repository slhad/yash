Purge Fork Notification & Contributor Migration (tracked)

Purpose:
- Document the policy and scripts used to notify fork owners about the planned destructive history rewrite and provide migration instructions.

Policy:
- By default run notifier in dry-run mode to produce a list of affected forks (tmp/notify-forks-dryrun.txt).
- Operator must manually review the list and then run notifier with --confirm and PROVIDE_NOTIFY_TOKEN to post issues.
- Notifier logs failures to tmp/notify-forks-failures.txt for manual follow-up.

Scripts:
- scripts/notify-forks.sh (dry-run by default; requires PROVIDE_NOTIFY_TOKEN and --confirm to post issues)
- scripts/generate-contributor-migration.sh (writes tmp/migration-instructions.sh)

Communication:
- Post an announcement in the parent repo linking to the canary PR, simulation report, and migration instructions.
