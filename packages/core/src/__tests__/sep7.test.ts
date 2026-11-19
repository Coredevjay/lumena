import { describe, expect, it } from "vitest";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { buildPayUri, parsePayUri, type PayUriParams } from "../stellar/sep7.js";

describe("stellar/sep7", () => {
  const destination = Keypair.random().publicKey();
  const issuer = Keypair.random().publicKey();

  describe("round trip", () => {
    it("round-trips a destination-only URI", () => {
      const uri = buildPayUri({ destination });
      expect(uri).toBe(`web+stellar:pay?destination=${destination}`);
      expect(parsePayUri(uri)).toEqual({ destination });
    });

    it("round-trips every supported field", () => {
      const params: PayUriParams = {
        destination,
        amount: "120.1234567",
        assetCode: "USDC",
        assetIssuer: issuer,
        memo: "order #42 & more",
        memoType: "MEMO_TEXT",
        callback: "url:https://example.com/callback?x=1",
        msg: "pay for order 42",
        networkPassphrase: Networks.TESTNET,
      };
      expect(parsePayUri(buildPayUri(params))).toEqual(params);
    });

    it("round-trips MEMO_ID and MEMO_HASH memos", () => {
      const idParams: PayUriParams = { destination, memo: "18446744073709551615", memoType: "MEMO_ID" };
      expect(parsePayUri(buildPayUri(idParams))).toEqual(idParams);

      const hash = `${"A".repeat(43)}=`;
      const hashParams: PayUriParams = { destination, memo: hash, memoType: "MEMO_HASH" };
      expect(parsePayUri(buildPayUri(hashParams))).toEqual(hashParams);
    });

    it("accepts a case-insensitive scheme and surrounding whitespace", () => {
      expect(parsePayUri(`  WEB+STELLAR:PAY?destination=${destination}  `)).toEqual({ destination });
    });
  });

  describe("malformed input", () => {
    it.each([
      ["a non-pay operation", `web+stellar:tx?xdr=AAAA`],
      ["a different scheme", `https://example.com/pay?destination=${destination}`],
      ["a missing destination", "web+stellar:pay?amount=1"],
      ["an invalid destination", "web+stellar:pay?destination=GABC"],
      ["a duplicate parameter", `web+stellar:pay?destination=${destination}&amount=1&amount=2`],
      ["a negative amount", `web+stellar:pay?destination=${destination}&amount=-1`],
      ["a zero amount", `web+stellar:pay?destination=${destination}&amount=0.0`],
      ["too many decimals", `web+stellar:pay?destination=${destination}&amount=1.12345678`],
      ["an asset code without issuer", `web+stellar:pay?destination=${destination}&asset_code=USDC`],
      ["an issuer without asset code", `web+stellar:pay?destination=${destination}&asset_issuer=${issuer}`],
      ["an overlong asset code", `web+stellar:pay?destination=${destination}&asset_code=ABCDEFGHIJKLM&asset_issuer=${issuer}`],
      ["memo_type without memo", `web+stellar:pay?destination=${destination}&memo_type=MEMO_TEXT`],
      ["an unknown memo_type", `web+stellar:pay?destination=${destination}&memo=x&memo_type=MEMO_FOO`],
      ["an overlong MEMO_TEXT", `web+stellar:pay?destination=${destination}&memo=${"a".repeat(29)}`],
      ["a non-numeric MEMO_ID", `web+stellar:pay?destination=${destination}&memo=abc&memo_type=MEMO_ID`],
      ["an out-of-range MEMO_ID", `web+stellar:pay?destination=${destination}&memo=18446744073709551616&memo_type=MEMO_ID`],
      ["a malformed MEMO_HASH", `web+stellar:pay?destination=${destination}&memo=abc&memo_type=MEMO_HASH`],
      ["a callback without url: prefix", `web+stellar:pay?destination=${destination}&callback=https%3A%2F%2Fexample.com`],
      ["a non-https callback", `web+stellar:pay?destination=${destination}&callback=url%3Ahttp%3A%2F%2Fexample.com`],
      ["an overlong msg", `web+stellar:pay?destination=${destination}&msg=${"a".repeat(301)}`],
      ["an empty network passphrase", `web+stellar:pay?destination=${destination}&network_passphrase=`],
    ])("rejects %s", (_label, uri) => {
      expect(() => parsePayUri(uri)).toThrow(/SEP-0007/);
    });

    it("refuses to build a URI with invalid fields", () => {
      expect(() => buildPayUri({ destination: "not-an-account" })).toThrow(/destination/);
      expect(() => buildPayUri({ destination, amount: "abc" })).toThrow(/amount/);
      expect(() => buildPayUri({ destination, assetCode: "USDC" })).toThrow(/asset_issuer/);
    });
  });
});
