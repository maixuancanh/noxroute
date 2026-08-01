import assert from "node:assert/strict";
import test from "node:test";

import { NoxRoutePrivacy } from "../dapp/v3-privacy.js";

test("owner reveal treats an empty confidential token balance as zero without decrypting a zero handle", async () => {
  const zeroHandle = `0x${"00".repeat(32)}`;
  const decryptedHandles = [];
  const client = {
    async decrypt(handle) {
      decryptedHandles.push(handle);
      if (BigInt(handle) === 0n) {
        throw new Error("Handle chainId (0) does not match connected chainId (11155111)");
      }
      return { value: 1n };
    },
  };
  const chain = {
    uiSimulation: false,
    account: "0x0000000000000000000000000000000000000001",
    deployment: { weth: "0xweth", usdc: "0xusdc" },
    async strategy() {
      return {
        handles: {
          direction: "0x01",
          remaining: "0x02",
          clip: "0x03",
          limitPriceWad: "0x04",
          slippageBps: "0x05",
        },
      };
    },
    readContracts: {
      vault: {
        async availableHandle(_owner, token) {
          return token === "0xweth" ? "0x06" : zeroHandle;
        },
      },
    },
  };
  const privacy = new NoxRoutePrivacy(chain);
  privacy.handleClient = client;
  privacy.retry = async (_label, action) => action();

  const revealed = await privacy.decryptOwnerState("0xstrategy");

  assert.equal(revealed.usdcBalance, 0n);
  assert.equal(decryptedHandles.includes(zeroHandle), false);
});
