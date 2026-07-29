FROM node:20-slim

# Chromium runtime deps — Puppeteer's bundled Chromium needs these system libs,
# they are NOT included by `npm install puppeteer`.
#
# NOTE: package names below are current for Debian bookworm (node:20-slim base).
# If `docker build` fails with "Unable to locate package libasound2" (or similar),
# the base image's package repo may have renamed/split a package — e.g. Ubuntu
# 22.04+/24.04 renamed libasound2 -> libasound2t64. Fix by swapping the exact
# offending name(s) below; the rest of the list should still resolve.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 lsb-release wget xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json .
RUN npm install

COPY . .

# Puppeteer downloads Chromium into node_modules/.cache/puppeteer during `npm install`
# above; the docker-compose volume mount persists it across container recreates.

EXPOSE 3100

CMD ["node", "server.js"]
