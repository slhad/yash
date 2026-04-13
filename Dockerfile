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
# The bun installer writes into /root/.bun by default; create a symlink into
# /usr/local/bin so containers run with --user can still execute bun.
RUN curl -fsSL https://bun.sh/install | bash -s -- -y \
  && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
  && chmod +x /usr/local/bin/bun
ENV PATH="/usr/local/bin:/root/.bun/bin:${PATH}"

WORKDIR /app

# Copy project files
COPY . /app

# Copy CI entrypoint that can chown mounted /app/tmp when HOST_UID/HOST_GID provided
# This makes artifact ownership easier when the CI job passes host UID/GID.
COPY scripts/ci/ci-entrypoint.sh /usr/local/bin/ci-entrypoint.sh
RUN chmod +x /usr/local/bin/ci-entrypoint.sh || true
 
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

# If HOST_UID/HOST_GID are provided as build-args, create a matching user inside
# the image at build time to simplify mounted artifact ownership when possible.
RUN if [ "${HOST_UID}" != "1000" ] || [ "${HOST_GID}" != "1000" ]; then \
      groupadd -g "${HOST_GID}" hostgroup 2>/dev/null || true; \
      useradd -u "${HOST_UID}" -g "${HOST_GID}" -m -d /home/hostuser -s /bin/bash hostuser 2>/dev/null || true; \
    fi || true

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

# Default entrypoint: allow CI to pass HOST_UID/HOST_GID and have the image chown /app/tmp early
ENTRYPOINT ["/usr/local/bin/ci-entrypoint.sh"]
