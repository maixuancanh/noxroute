# Archived UI tests

`dapp-ui-v2-retired.mjs` preserves the static assertions for the superseded V2/Orbiter UI. It is intentionally outside the auto-discovered `test/` tree and non-gating because the V3 product replaced the old DOM, BOIN/BOOUT, and demo-filler requirements.

The current UI regression gate is `test/dapp-ui-v3.test.mjs`, run by `npm run test:unit:v3`.
