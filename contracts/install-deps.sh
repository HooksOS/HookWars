#!/usr/bin/env bash
# =============================================================================
# Deterministic, PINNED install of the Foundry dependencies for HookWars.
# Replaces git submodules so every environment (local + CI) reproduces the
# EXACT commits that compile and pass `forge test`.
#
# Matched-pair rule (see README): v4-core and v4-periphery MUST stay on these
# commits together — periphery@3779387 is the last commit shipping BaseHook,
# and it vendors v4-core@59d3ecf, which the remappings resolve against.
# Do not bump either independently.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

pin() { # url commit dest
  local url="$1" commit="$2" dest="$3"
  if [ -d "$dest/.git" ] && [ "$(git -C "$dest" rev-parse HEAD 2>/dev/null || true)" = "$commit" ]; then
    echo "ok    $dest @ ${commit:0:10}"
    return
  fi
  rm -rf "$dest"
  git clone --quiet "$url" "$dest"
  git -C "$dest" checkout --quiet "$commit"
  git -C "$dest" submodule update --init --recursive --quiet
  echo "fetch $dest @ ${commit:0:10}"
}

pin https://github.com/OpenZeppelin/openzeppelin-contracts 5fd1781b1454fd1ef8e722282f86f9293cacf256 lib/openzeppelin-contracts
pin https://github.com/Vectorized/solady                   acd959aa4bd04720d640bf4e6a5c71037510cc4b lib/solady
pin https://github.com/foundry-rs/forge-std                620536fa5277db4e3fd46772d5cbc1ea0696fb43 lib/forge-std
pin https://github.com/Uniswap/permit2                     cc56ad0f3439c502c246fc5cfcc3db92bb8b7219 lib/permit2
# Matched v4 pair — periphery's recursive submodules bring the vendored v4-core
# that remappings.txt resolves `v4-core/` and `@uniswap/v4-core/` against.
pin https://github.com/Uniswap/v4-periphery                3779387e5d296f39df543d23524b050f89a62917 lib/v4-periphery
pin https://github.com/Uniswap/v4-core                     59d3ecf53afa9264a16bba0e38f4c5d2231f80bc lib/v4-core

echo "Dependencies pinned. Next: forge build && forge test"
