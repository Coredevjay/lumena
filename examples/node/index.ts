import { Keypair } from "@stellar/stellar-sdk";
import { StellarClient, Wallet, getNativeAsset, TESTNET } from "@lumen/core";

const client = new StellarClient({ network: TESTNET.network });
const serverKeypair = Keypair.fromSecret(process.env.LUMEN_SERVER_SECRET ?? Keypair.random().secret());

const wallet = new Wallet({
  address: serverKeypair.publicKey(),
  client,
});

console.log({
  network: client.config.network,
  wallet: wallet.address,
  nativeAsset: getNativeAsset().getCode(),
});