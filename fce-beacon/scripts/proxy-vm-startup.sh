#!/usr/bin/env bash
# GCE startup: install Docker + ngrok. Secrets are NOT in this script.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl jq gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod 0644 /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
curl -fsSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc -o /etc/apt/trusted.gpg.d/ngrok.asc
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" > /etc/apt/sources.list.d/ngrok.list
apt-get update
apt-get install -y ngrok
mkdir -p /opt/beacon-fcc
chmod 700 /opt/beacon-fcc
date -u +%Y-%m-%dT%H:%M:%SZ > /opt/beacon-fcc/STARTUP_DONE
