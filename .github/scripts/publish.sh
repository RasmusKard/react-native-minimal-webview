#!/usr/bin/env bash
# Publishes a draft release's attested tarball to npm, then un-drafts the release. Usage: .github/scripts/publish.sh <tag>,
# e.g. react-native-minimal-webview-v1.0.0 or extensions-v1.0.0. When both packages release, publish the core first: the
# extensions package takes it as a peer.
set -euo pipefail
tag=${1:?usage: $0 <tag>}
repo=RasmusKard/react-native-minimal-webview
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
gh release download "$tag" -p '*.tgz' -D "$dir" -R "$repo"
tarball=$(echo "$dir"/*.tgz)
gh attestation verify "$tarball" -R "$repo" \
  --signer-workflow "$repo/.github/workflows/release.yml" --source-ref refs/heads/main --deny-self-hosted-runners
npm publish "$tarball"
gh release edit "$tag" --draft=false -R "$repo"
