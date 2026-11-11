#!/usr/bin/env bash
# Container image + Dockerfile/IaC misconfiguration scan.
source "$(dirname "$0")/_common.sh"
docker build -t voyager:scan "$ROOT"
trivy image --severity HIGH,CRITICAL --format json --output "$OUT/trivy-image.json" voyager:scan
trivy config --format json --output "$OUT/trivy-config.json" "$ROOT"
