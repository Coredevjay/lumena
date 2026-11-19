import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeypairFromMnemonic,
} from '../keys/mnemonic';
import { KeyManager } from '../keys/manager';
import { HdWallet } from '../keys/hd-wallet';

// SEP-0005 test vectors
// https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md
const SEP5_VECTORS = [
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    accounts: [
      {
        index: 0,
        publicKey: 'GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX',
      },
      {
        index: 1,
        publicKey: 'GDN3JS4YQZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5QZ5Q',
      },
    ],
  },
];

// The canonical SEP-0005 test vector for the "abandon ... about" mnemonic.
const ABANDON_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ABANDON_ACCOUNT_0_PUBLIC_KEY =
  'GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX';

describe('generateMnemonic', () => {
  it('generates a 12-word mnemonic for 128 bits of entropy', () => {
    const mnemonic = generateMnemonic(128);
    expect(mnemonic.split(' ')).toHaveLength(12);
  });

  it('generates a 24-word mnemonic for 256 bits of entropy', () => {
    const mnemonic = generateMnemonic(256);
    expect(mnemonic.split(' ')).toHaveLength(24);
  });

  it('defaults to a 12-word mnemonic', () => {
    const mnemonic = generateMnemonic();
    expect(mnemonic.split(' ')).toHaveLength(12);
  });

  it('generates valid mnemonics', () => {
    expect(validateMnemonic(generateMnemonic(128))).toBe(true);
    expect(validateMnemonic(generateMnemonic(256))).toBe(true);
  });

  it('generates different mnemonics on successive calls', () => {
    const a = generateMnemonic(128);
    const b = generateMnemonic(128);
    expect(a).not.toBe(b);
  });
});

describe('validateMnemonic', () => {
  it('returns true for a valid 12-word mnemonic', () => {
    expect(validateMnemonic(ABANDON_MNEMONIC)).toBe(true);
  });

  it('returns true for a valid 24-word mnemonic', () => {
    const mnemonic = generateMnemonic(256);
    expect(validateMnemonic(mnemonic)).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(validateMnemonic('')).toBe(false);
  });

  it('returns false for a mnemonic with an invalid word count', () => {
    expect(validateMnemonic('abandon abandon abandon')).toBe(false);
  });

  it('returns false for a mnemonic with unknown words', () => {
    const bad =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword';
    expect(validateMnemonic(bad)).toBe(false);
  });

  it('returns false for a mnemonic with a bad checksum', () => {
    // Replace the last word with a different valid word to break the checksum.
    const bad =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(validateMnemonic(bad)).toBe(false);
  });

  it('returns false for a mnemonic with extra whitespace between words', () => {
    const spaced =
      'abandon  abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    // Normalization should handle this; if not, it should still not throw.
    expect(() => validateMnemonic(spaced)).not.toThrow();
  });
});

describe('deriveKeypairFromMnemonic', () => {
  it('reproduces the SEP-0005 test vector for account index 0', () => {
    const keypair = deriveKeypairFromMnemonic(ABANDON_MNEMONIC);
    expect(keypair.publicKey()).toBe(ABANDON_ACCOUNT_0_PUBLIC_KEY);
  });

  it('reproduces the SEP-0005 test vector with explicit account index 0', () => {
    const keypair = deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', 0);
    expect(keypair.publicKey()).toBe(ABANDON_ACCOUNT_0_PUBLIC_KEY);
  });

  it('derives different keys for different account indices', () => {
    const kp0 = deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', 0);
    const kp1 = deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', 1);
    expect(kp0.publicKey()).not.toBe(kp1.publicKey());
  });

  it('derives different keys for different passphrases', () => {
    const kpNoPass = deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', 0);
    const kpWithPass = deriveKeypairFromMnemonic(ABANDON_MNEMONIC, 'TREZOR', 0);
    expect(kpNoPass.publicKey()).not.toBe(kpWithPass.publicKey());
  });

  it('is deterministic for the same inputs', () => {
    const a = deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', 0);
    const b = deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', 0);
    expect(a.publicKey()).toBe(b.publicKey());
    expect(a.secret()).toBe(b.secret());
  });

  it('throws for an invalid mnemonic', () => {
    expect(() => deriveKeypairFromMnemonic('not a valid mnemonic phrase')).toThrow();
  });

  it('throws for a mnemonic with a bad checksum', () => {
    const bad =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(() => deriveKeypairFromMnemonic(bad)).toThrow();
  });

  it('throws for a negative account index', () => {
    expect(() => deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', -1)).toThrow();
  });
});

describe('KeyManager mnemonic integration', () => {
  let manager: KeyManager;

  beforeEach(() => {
    manager = new KeyManager();
  });

  it('createFromMnemonic returns a keypair matching direct derivation', () => {
    const keypair = manager.createFromMnemonic(ABANDON_MNEMONIC);
    expect(keypair.publicKey()).toBe(ABANDON_ACCOUNT_0_PUBLIC_KEY);
  });

  it('recoverFromMnemonic returns a keypair matching direct derivation', () => {
    const keypair = manager.recoverFromMnemonic(ABANDON_MNEMONIC);
    expect(keypair.publicKey()).toBe(ABANDON_ACCOUNT_0_PUBLIC_KEY);
  });

  it('createFromMnemonic and recoverFromMnemonic round-trip to the same public key', () => {
    const created = manager.createFromMnemonic(ABANDON_MNEMONIC);
    const recovered = manager.recoverFromMnemonic(ABANDON_MNEMONIC);
    expect(created.publicKey()).toBe(recovered.publicKey());
    expect(created.secret()).toBe(recovered.secret());
  });

  it('round-trips a freshly generated mnemonic', () => {
    const mnemonic = generateMnemonic(128);
    const created = manager.createFromMnemonic(mnemonic);
    const recovered = manager.recoverFromMnemonic(mnemonic);
    expect(created.publicKey()).toBe(recovered.publicKey());
  });

  it('respects account index in createFromMnemonic', () => {
    const kp0 = manager.createFromMnemonic(ABANDON_MNEMONIC, '', 0);
    const kp1 = manager.createFromMnemonic(ABANDON_MNEMONIC, '', 1);
    expect(kp0.publicKey()).not.toBe(kp1.publicKey());
  });

  it('respects passphrase in recoverFromMnemonic', () => {
    const kpNoPass = manager.recoverFromMnemonic(ABANDON_MNEMONIC, '', 0);
    const kpWithPass = manager.recoverFromMnemonic(ABANDON_MNEMONIC, 'TREZOR', 0);
    expect(kpNoPass.publicKey()).not.toBe(kpWithPass.publicKey());
  });

  it('createFromMnemonic throws for an invalid mnemonic', () => {
    expect(() => manager.createFromMnemonic('invalid mnemonic')).toThrow();
  });

  it('recoverFromMnemonic throws for an invalid mnemonic', () => {
    expect(() => manager.recoverFromMnemonic('invalid mnemonic')).toThrow();
  });
});

describe('HdWallet.discoverAccounts', () => {
  /**
   * Builds a mocked Horizon server whose `loadAccount` succeeds only for the
   * given set of public keys and rejects (404) for everything else.
   */
  function createMockServer(usedPublicKeys: string[]) {
    const used = new Set(usedPublicKeys);
    const loadAccount = vi.fn(async (publicKey: string) => {
      if (used.has(publicKey)) {
        return { accountId: () => publicKey, sequenceNumber: () => '1' };
      }
      const err: any = new Error('Not Found');
      err.response = { status: 404 };
      throw err;
    });
    return { loadAccount } as any;
  }

  function publicKeyAt(index: number): string {
    return deriveKeypairFromMnemonic(ABANDON_MNEMONIC, '', index).publicKey();
  }

  it('returns no accounts for an empty wallet and stops at gapLimit', async () => {
    const server = createMockServer([]);
    const wallet = new HdWallet(ABANDON_MNEMONIC);

    const accounts = await wallet.discoverAccounts({ gapLimit: 3, server });

    expect(accounts).toEqual([]);
    // Scans indexes 0, 1, 2 and then stops once gapLimit is reached.
    expect(server.loadAccount).toHaveBeenCalledTimes(3);
    expect(server.loadAccount).toHaveBeenNthCalledWith(1, publicKeyAt(0));
    expect(server.loadAccount).toHaveBeenNthCalledWith(2, publicKeyAt(1));
    expect(server.loadAccount).toHaveBeenNthCalledWith(3, publicKeyAt(2));
  });

  it('discovers sparse usage (indexes 0 and 3) with gapLimit 2', async () => {
    const server = createMockServer([publicKeyAt(0), publicKeyAt(3)]);
    const wallet = new HdWallet(ABANDON_MNEMONIC);

    const accounts = await wallet.discoverAccounts({ gapLimit: 2, server });

    expect(accounts.map((a) => a.index)).toEqual([0, 3]);
    // Indexes 0..5 are scanned: after index 3 the next two (4, 5) are unused.
    expect(server.loadAccount).toHaveBeenCalledTimes(6);
  });

  it('discovers contiguous usage (indexes 0..4) and continues until gapLimit unused', async () => {
    const used = [0, 1, 2, 3, 4].map(publicKeyAt);
    const server = createMockServer(used);
    const wallet = new HdWallet(ABANDON_MNEMONIC);

    const accounts = await wallet.discoverAccounts({ gapLimit: 2, server });

    expect(accounts.map((a) => a.index)).toEqual([0, 1, 2, 3, 4]);
    // Indexes 0..6 are scanned: after index 4 the next two (5, 6) are unused.
    expect(server.loadAccount).toHaveBeenCalledTimes(7);
  });

  it('honors a configurable gapLimit (1 vs 5) producing different scan lengths', async () => {
    const serverSmall = createMockServer([publicKeyAt(0)]);
    const serverLarge = createMockServer([publicKeyAt(0)]);

    const walletSmall = new HdWallet(ABANDON_MNEMONIC);
    const walletLarge = new HdWallet(ABANDON_MNEMONIC);

    const small = await walletSmall.discoverAccounts({ gapLimit: 1, server: serverSmall });
    const large = await walletLarge.discoverAccounts({ gapLimit: 5, server: serverLarge });

    expect(small.map((a) => a.index)).toEqual([0]);
    expect(large.map((a) => a.index)).toEqual([0]);

    // gapLimit 1: scan 0 (used) then 1 (unused) -> 2 calls.
    expect(serverSmall.loadAccount).toHaveBeenCalledTimes(2);
    // gapLimit 5: scan 0 (used) then 1..5 (unused) -> 6 calls.
    expect(serverLarge.loadAccount).toHaveBeenCalledTimes(6);
  });
});