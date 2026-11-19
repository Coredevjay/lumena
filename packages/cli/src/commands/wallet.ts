import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  createWallet,
  importWallet,
  encryptKeystore,
  type Keystore,
} from "@lumen/core";

export interface WalletCommandIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  prompt: (question: string, options?: { silent?: boolean }) => Promise<string>;
}

export interface WalletCreateOptions {
  json?: boolean;
  out?: string;
  passphrase?: string;
  showSecret?: boolean;
}

export interface WalletImportOptions {
  json?: boolean;
  out?: string;
  passphrase?: string;
  showSecret?: boolean;
  secret?: string;
}

const DEFAULT_KEYSTORE_DIR = ".lumen/keystore";

function defaultIO(): WalletCommandIO {
  return {
    stdout: (line: string) => process.stdout.write(`${line}\n`),
    stderr: (line: string) => process.stderr.write(`${line}\n`),
    prompt: (question: string, options?: { silent?: boolean }) =>
      new Promise<string>((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: options?.silent ? undefined : process.stdout,
          terminal: true,
        });
        if (options?.silent && process.stdin.isTTY) {
          process.stdout.write(question);
        } else if (!options?.silent) {
          rl.setPrompt(question);
          rl.prompt();
        }
        rl.once("line", (answer: string) => {
          rl.close();
          if (options?.silent && process.stdin.isTTY) {
            process.stdout.write("\n");
          }
          resolve(answer);
        });
      }),
  };
}

async function resolvePassphrase(
  io: WalletCommandIO,
  provided?: string,
): Promise<string> {
  if (provided !== undefined && provided !== "") {
    return provided;
  }
  const fromEnv = process.env.LUMEN_KEYSTORE_PASSPHRASE;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  const first = await io.prompt("Keystore passphrase: ", { silent: true });
  if (first === "") {
    throw new Error("Passphrase must not be empty");
  }
  const second = await io.prompt("Confirm passphrase: ", { silent: true });
  if (first !== second) {
    throw new Error("Passphrases do not match");
  }
  return first;
}

function resolveOutPath(out: string | undefined, address: string): string {
  if (out) {
    return path.resolve(out);
  }
  return path.resolve(DEFAULT_KEYSTORE_DIR, `${address}.json`);
}

async function writeKeystore(outPath: string, keystore: Keystore): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(keystore, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function emitResult(
  io: WalletCommandIO,
  options: { json?: boolean; showSecret?: boolean },
  payload: {
    address: string;
    publicKey: string;
    keystorePath: string;
    secret?: string;
  },
): void {
  const includeSecret = options.showSecret === true && payload.secret !== undefined;
  if (options.json) {
    const body: Record<string, unknown> = {
      address: payload.address,
      publicKey: payload.publicKey,
      keystorePath: payload.keystorePath,
    };
    if (includeSecret) {
      body.secret = payload.secret;
    }
    io.stdout(JSON.stringify(body));
    return;
  }
  io.stdout(`Address:    ${payload.address}`);
  io.stdout(`Public key: ${payload.publicKey}`);
  io.stdout(`Keystore:   ${payload.keystorePath}`);
  if (includeSecret) {
    io.stdout(`Secret:     ${payload.secret}`);
  } else {
    io.stdout("Secret:     (hidden; pass --show-secret to print)");
  }
}

export async function runWalletCreate(
  options: WalletCreateOptions = {},
  io: WalletCommandIO = defaultIO(),
): Promise<number> {
  try {
    const passphrase = await resolvePassphrase(io, options.passphrase);
    const wallet = await createWallet();
    const keystore = await encryptKeystore(wallet.secret, passphrase);
    const outPath = resolveOutPath(options.out, wallet.address);
    await writeKeystore(outPath, keystore);
    emitResult(io, options, {
      address: wallet.address,
      publicKey: wallet.publicKey,
      keystorePath: outPath,
      secret: wallet.secret,
    });
    return 0;
  } catch (error) {
    io.stderr(`Error: ${(error as Error).message}`);
    return 1;
  }
}

export async function runWalletImport(
  options: WalletImportOptions = {},
  io: WalletCommandIO = defaultIO(),
): Promise<number> {
  try {
    let secret = options.secret;
    if (secret === undefined || secret === "") {
      secret = await io.prompt("Secret key: ", { silent: true });
    }
    if (secret === "") {
      throw new Error("Secret key must not be empty");
    }
    const passphrase = await resolvePassphrase(io, options.passphrase);
    const wallet = await importWallet(secret);
    const keystore = await encryptKeystore(wallet.secret, passphrase);
    const outPath = resolveOutPath(options.out, wallet.address);
    await writeKeystore(outPath, keystore);
    emitResult(io, options, {
      address: wallet.address,
      publicKey: wallet.publicKey,
      keystorePath: outPath,
      secret: wallet.secret,
    });
    return 0;
  } catch (error) {
    io.stderr(`Error: ${(error as Error).message}`);
    return 1;
  }
}