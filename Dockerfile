FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

# Optional build args to create a host-matching user inside the image. CI can pass
# these (via --build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)) to bake
# a user with matching UID/GID into the image which can simplify artifact ownership.
ARG HOST_UID=1000
ARG HOST_GID=1000

# Install essentials and Playwright deps
RUN apt-get update && apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg apt-transport-https lsb-release build-essential git procps \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libx11-6 libgbm1 \
  libasound2 libpangocairo-1.0-0 libxshmfence1 libxrandr2 libxcomposite1 libxss1 libxcb1 \
  libxdamage1 libxext6 libxrender1 libxfixes3 libglib2.0-0 libgtk-3-0 \
  ca-certificates xz-utils unzip \
  && rm -rf /var/lib/apt/lists/*

# Install Node 18 (for Playwright tooling)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
  && apt-get update && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

# Install Bun and make it available system-wide so non-root users can run it.
# The bun installer writes into /root/.bun by default. The installer does not
# accept a '-y' flag; invoking it with '-y' causes it to treat '-y' as a tag and
# fail (404). Invoke the installer without '-y', then copy the bun binary into
# /usr/local/bin to avoid relying on traversing /root from non-root users.
RUN curl -fsSL https://bun.sh/install | bash -s -- \
  && if [ -f /root/.bun/bin/bun ]; then \
       cp -f /root/.bun/bin/bun /usr/local/bin/bun; \
       chmod +x /usr/local/bin/bun; \
     else \
       ln -sf /root/.bun/bin/bun /usr/local/bin/bun || true; \
     fi
ENV PATH="/usr/local/bin:/root/.bun/bin:${PATH}"

WORKDIR /app

# Copy project files
COPY . /app

# NOTE: This repository previously included a small CI entrypoint script
# (scripts/ci/ci-entrypoint.sh) that helped with chowning mounted artifact
# directories when CI passed HOST_UID/HOST_GID. That helper has been removed
# from the repository. CI builders who need similar behavior should COPY a
# small entrypoint during their own image build or add a dedicated tooling
# repository containing CI helpers.
 
# Install gosu for reliable privilege drop in ci-entrypoint (used to run commands
# as a host-matching user without relying on su). We download the prebuilt
# binary from the upstream releases and install it to /usr/local/bin.
RUN set -eux; \
    dpkgArch="$(dpkg --print-architecture)"; \
    case "${dpkgArch}" in \
      amd64) gosu_arch="amd64" ;; \
      arm64) gosu_arch="arm64" ;; \
      armhf) gosu_arch="armhf" ;; \
      *) gosu_arch="${dpkgArch}" ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/1.16/gosu-${gosu_arch}"; \
    chmod +x /usr/local/bin/gosu; \
    /usr/local/bin/gosu --version || true

# Create a host-matching user/group inside the image at build time using the
# provided HOST_UID/HOST_GID build args. This bakes a user with matching numeric
# IDs into the image which can be used in the "bake-user" CI flow where the
# container may be run without --user and the entrypoint drops to the baked user.
RUN set -eux; \
    groupadd -g "${HOST_GID}" hostgroup 2>/dev/null || true; \
    useradd -u "${HOST_UID}" -g "${HOST_GID}" -m -d /home/hostuser -s /bin/bash hostuser 2>/dev/null || true

# Install dependencies via Bun
RUN bun install --no-save || true

# Configure Playwright browsers to be installed into a global, world-readable
# directory so non-root users (containers run with --user) can execute them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright-browsers
RUN mkdir -p /ms-playwright-browsers \
    && chown root:root /ms-playwright-browsers \
    && chmod 0755 /ms-playwright-browsers

# Install Playwright browsers into the shared path and make them readable/executable
# by non-root users at runtime.
RUN PLAYWRIGHT_BROWSERS_PATH=/ms-playwright-browsers npx playwright install --with-deps || true
RUN chmod -R a+rX /ms-playwright-browsers || true

# Expose server port
EXPOSE 3000

# Default command: show usage (CI will override)
CMD ["/bin/bash", "-lc", "echo 'Image built. Run tests with: bun test or npx playwright test'"]
