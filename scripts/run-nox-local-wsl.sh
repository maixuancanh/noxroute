#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.local/bin:${PATH}"

readonly SOURCE_DIR="/mnt/d/dorahack/ixec/projects/nox-batch"
readonly EVIDENCE_DIR="${SOURCE_DIR}/evidence"
TEMP_ROOT="$(mktemp -d -t noxveil-v3-local.XXXXXX)"
readonly TEMP_ROOT

cleanup() {
  case "${TEMP_ROOT}" in
    /tmp/noxveil-v3-local.*) rm -rf -- "${TEMP_ROOT}" ;;
    *) printf 'Refusing to remove unexpected temporary path: %s\n' "${TEMP_ROOT}" >&2 ;;
  esac
}
trap cleanup EXIT

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ -z "${node_major}" || "${node_major}" -lt 22 ]]; then
  printf 'Node.js 22+ is required inside WSL; found %s\n' "$(node --version 2>/dev/null || printf 'none')" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  printf 'Docker Engine is not reachable inside WSL. Start the native WSL Docker service first.\n' >&2
  exit 1
fi

if [[ ! -f "${SOURCE_DIR}/package-lock.json" ]]; then
  printf 'Project source was not found at %s\n' "${SOURCE_DIR}" >&2
  exit 1
fi

mkdir -p "${TEMP_ROOT}/repo" "${EVIDENCE_DIR}"
rsync -a \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'artifacts' \
  --exclude 'cache' \
  --exclude 'evidence/*.json' \
  --exclude 'evidence/*.log' \
  "${SOURCE_DIR}/" "${TEMP_ROOT}/repo/"

cd "${TEMP_ROOT}/repo"
npm ci

set +e
npm run test:nox:local:v3:inner 2>&1 | tee "${TEMP_ROOT}/local-nox-v3.log"
test_status="${PIPESTATUS[0]}"
set -e

if [[ "${test_status}" -ne 0 ]]; then
  printf 'Nox local tests failed; no success evidence was written.\n' >&2
  exit "${test_status}"
fi

sed -E \
  -e 's#https://[^[:space:]]+#<redacted-url>#g' \
  -e 's#0x[0-9a-fA-F]{64}#<redacted-32-byte-value>#g' \
  "${TEMP_ROOT}/local-nox-v3.log" > "${EVIDENCE_DIR}/local-nox-v3.log"
printf 'Sanitized local Nox evidence: %s\n' "${EVIDENCE_DIR}/local-nox-v3.log"
