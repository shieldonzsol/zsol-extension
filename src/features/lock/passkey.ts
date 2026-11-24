// The panel's own passkey keeps the private wallet's seed on this device: sealed under a key from
// the passkey's PRF extension (WebAuthn, then HKDF to AES-GCM). Touch ID, Windows Hello or the
// device's PIN opens it again, even after Chrome restarts. The passkey belongs to this extension
// alone and signs nobody in: nothing about it is sent anywhere.
import {
  fromBase64Url,
  randomBytes,
  seal,
  toBase64Url,
  unseal,
  type SealedBox,
} from "./sealed-bytes";

/** What the panel keeps in its storage: the seed, sealed, and which passkey opens it. */
export interface SealedSeed extends SealedBox {
  readonly v: 1;
  /** The sign-in wallet whose account the seed belongs to. */
  readonly wallet: string;
  /** The zSol the panel paired with. */
  readonly site: string;
  /** The passkey's credential id, base64url. */
  readonly credential: string;
  /** The PRF input, base64url. */
  readonly salt: string;
}

export class PasskeyError extends Error {
  override readonly name = "PasskeyError";
  constructor(
    /** Dismissed or refused; not possible on this device; or the passkey doesn't open the copy. */
    readonly code: "cancelled" | "unsupported" | "unreadable",
    message: string,
  ) {
    super(message);
  }
}

const INFO = new TextEncoder().encode("zSol panel seed v1");

const factsOf = (owner: Pick<SealedSeed, "wallet" | "site" | "credential">) =>
  ["zSol panel seed v1", owner.wallet, owner.site, owner.credential].join("\n");

/** Whether this browser can keep a key in a passkey (WebAuthn's PRF extension). */
export async function passkeysUsable(): Promise<boolean> {
  if (typeof PublicKeyCredential === "undefined") return false;
  const read = Reflect.get(PublicKeyCredential, "getClientCapabilities");
  if (typeof read === "function") {
    const capabilities: unknown = await Promise.resolve(
      Reflect.apply(read, PublicKeyCredential, []),
    ).catch(() => null);
    const prf =
      typeof capabilities === "object" && capabilities !== null
        ? Reflect.get(capabilities, "extension:prf")
        : undefined;
    if (typeof prf === "boolean") return prf;
  }
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
}

function failure(error: unknown): PasskeyError {
  if (error instanceof PasskeyError) return error;
  const name = error instanceof DOMException ? error.name : "";
  return name === "NotAllowedError" || name === "AbortError"
    ? new PasskeyError("cancelled", "The passkey prompt was dismissed or refused.")
    : new PasskeyError("unsupported", `The passkey step failed: ${String(error)}`);
}

function bytesOf(source: unknown): Uint8Array<ArrayBuffer> | null {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return copy;
  }
  return null;
}

/** The PRF results a credential reported, read without trusting their shape. */
function prfOf(credential: PublicKeyCredential): {
  enabled: unknown;
  first: Uint8Array<ArrayBuffer> | null;
} {
  const prf: unknown = Reflect.get(credential.getClientExtensionResults(), "prf");
  if (typeof prf !== "object" || prf === null) return { enabled: undefined, first: null };
  const results: unknown = Reflect.get(prf, "results");
  return {
    enabled: Reflect.get(prf, "enabled"),
    first:
      typeof results === "object" && results !== null
        ? bytesOf(Reflect.get(results, "first"))
        : null,
  };
}

const prfInput = (salt: Uint8Array<ArrayBuffer>) => ({ prf: { eval: { first: salt } } });

async function prfOutput(
  credential: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const assertion = await navigator.credentials
    .get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: credential }],
        userVerification: "required",
        timeout: 120_000,
        extensions: prfInput(salt),
      },
    })
    .catch((error: unknown) => {
      throw failure(error);
    });
  if (!(assertion instanceof PublicKeyCredential)) {
    throw new PasskeyError("cancelled", "No passkey answered.");
  }
  const { first } = prfOf(assertion);
  if (!first) throw new PasskeyError("unsupported", "The passkey gave no PRF output.");
  return first;
}

async function keyOf(
  output: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", output, "HKDF", false, ["deriveKey"]);
  output.fill(0);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Makes this panel's passkey and seals the seed under it. Usually one prompt; two where the
 * passkey manager gives the PRF output only on use.
 */
export async function sealWithPasskey(input: {
  readonly wallet: string;
  readonly site: string;
  readonly seed: Uint8Array;
}): Promise<SealedSeed> {
  const salt = randomBytes(32);
  const made = await navigator.credentials
    .create({
      publicKey: {
        rp: { name: "zSol for Chrome", id: location.hostname },
        user: {
          id: randomBytes(16),
          name: `zSol ${input.wallet.slice(0, 4)}…${input.wallet.slice(-4)}`,
          displayName: "zSol private wallet",
        },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 120_000,
        extensions: prfInput(salt),
      },
    })
    .catch((error: unknown) => {
      throw failure(error);
    });
  if (!(made instanceof PublicKeyCredential)) {
    throw new PasskeyError("cancelled", "No passkey was made.");
  }
  const credential = new Uint8Array(made.rawId.slice(0));
  const prf = prfOf(made);
  if (prf.enabled === false) {
    throw new PasskeyError("unsupported", "This passkey can't keep a key (no PRF).");
  }
  const output = prf.first ?? (await prfOutput(credential, salt));
  const owner = { wallet: input.wallet, site: input.site, credential: toBase64Url(credential) };
  const box = await seal(await keyOf(output, salt), input.seed, factsOf(owner));
  return { v: 1, ...owner, salt: toBase64Url(salt), ...box };
}

/** The seed the passkey opens: one prompt. */
export async function openWithPasskey(sealed: SealedSeed): Promise<Uint8Array<ArrayBuffer>> {
  const salt = fromBase64Url(sealed.salt);
  const output = await prfOutput(fromBase64Url(sealed.credential), salt);
  const seed = await unseal(await keyOf(output, salt), sealed, factsOf(sealed));
  if (!seed || seed.length !== 32) {
    throw new PasskeyError("unreadable", "The passkey doesn't open this copy.");
  }
  return seed;
}

/** Asks the passkey manager to drop a passkey the panel no longer uses, where it can. */
export function forgetPasskey(credential: string) {
  const signal = Reflect.get(PublicKeyCredential, "signalUnknownCredential");
  if (typeof signal !== "function") return;
  void Promise.resolve(
    Reflect.apply(signal, PublicKeyCredential, [
      { rpId: location.hostname, credentialId: credential },
    ]),
  ).catch(() => undefined);
}
