FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

# Install essentials and Playwright deps
RUN apt-get update && apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg apt-transport-https lsb-release build-essential git procps \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libx11-6 libgbm1 \
  libasound2 libpangocairo-1.0-0 libxshmfence1 libxrandr2 libxcomposite1 libxss1 libxcb1 \
  libxdamage1 libxext6 libxrender1 libxfixes3 libglib2.0-0 libgtk-3-0 \
  ca-certificates xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Install Node 18 (for Playwright tooling)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
  && apt-get update && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash -s -- -y
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Copy project files
COPY . /app

# Install dependencies via Bun and ensure Playwright browsers are available
RUN bun install --no-save || true
RUN npx playwright install --with-deps || true

# Expose server port
EXPOSE 3000

# Default command: show usage (CI will override)
CMD ["/bin/bash", "-lc", "echo 'Image built. Run tests with: bun test or npx playwright test'"]
