#!/bin/bash
# install-puppeteer-deps.sh
# Run this script on your Linux VPS (e.g. Ubuntu / Debian) as root or sudo:
# bash install-puppeteer-deps.sh

echo "=========================================================="
echo "Installing Puppeteer & Chromium system dependencies on Linux"
echo "=========================================================="

sudo apt-get update -y

sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils \
  chromium-browser

echo ""
echo "Installing Puppeteer chrome dependencies via npx..."
npx puppeteer browsers install chrome --install-deps || true

echo "=========================================================="
echo "Done! Please restart your Node.js application (pm2 restart all)"
echo "=========================================================="

