#!/bin/sh
# Install project Git hooks from contrib samples into the local .git/hooks
# This is intentionally minimal and safe: it only copies files that exist in
# contrib and marks them executable in the local clone. It does not modify
# version control settings or push anything.

set -euo pipefail

install_one() {
	src="$1"
	dest="$2"
	if [ ! -f "$src" ]; then
		echo "install-hooks: source not found: $src" >&2
		return 1
	fi
	mkdir -p .git/hooks
	cp "$src" "$dest"
	chmod +x "$dest"
	echo "Installed $dest"
}

install_one "contrib/sendemail-validate.sample" ".git/hooks/sendemail-validate"

echo "All requested hooks installed."
