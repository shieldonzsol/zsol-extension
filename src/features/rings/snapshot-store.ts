// The private wallet's last snapshot, sealed by the SDK under a key from the wallet's own viewing
// secret, kept in this browser so opening it again syncs only what is new. Beside it, when it was
// last read from the chain, so the panel can say how old the balance it shows is.
import type { WalletStateStore } from "@heliuslabs/spr";

const DATABASE = "zsol-wallets";
const SNAPSHOTS = "snapshots";

export interface SnapshotStore extends WalletStateStore {
  /** When the snapshot was last saved after a read, in ms since the epoch. */
  readonly readAt: () => Promise<number | null>;
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Storage failed.")));
  });
}

function open(): Promise<IDBDatabase> {
  const opening = indexedDB.open(DATABASE, 1);
  opening.addEventListener("upgradeneeded", () => {
    opening.result.createObjectStore(SNAPSHOTS);
  });
  return settled(opening);
}

async function read(key: string): Promise<unknown> {
  const db = await open();
  try {
    return await settled(db.transaction(SNAPSHOTS, "readonly").objectStore(SNAPSHOTS).get(key));
  } finally {
    db.close();
  }
}

async function write(entries: Readonly<Record<string, unknown>>): Promise<void> {
  const db = await open();
  try {
    const transaction = db.transaction(SNAPSHOTS, "readwrite");
    const store = transaction.objectStore(SNAPSHOTS);
    for (const [key, value] of Object.entries(entries)) store.put(value, key);
    await new Promise<void>((resolve, reject) => {
      const failed = () => reject(transaction.error ?? new Error("Storage failed."));
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("error", failed);
      transaction.addEventListener("abort", failed);
    });
  } finally {
    db.close();
  }
}

/** One sealed snapshot per wallet and network, replaced whole on each save. */
export function snapshotStore(network: string, wallet: string): SnapshotStore {
  const key = `${network}:${wallet}`;
  const at = `${key}:read-at`;
  return {
    async load() {
      const value = await read(key);
      return typeof value === "string" ? value : undefined;
    },
    save: (snapshot) => write({ [key]: snapshot, [at]: Date.now() }),
    async readAt() {
      const value = await read(at);
      return typeof value === "number" ? value : null;
    },
  };
}
