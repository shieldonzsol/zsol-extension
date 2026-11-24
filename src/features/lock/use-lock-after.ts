import { useEffect, useState } from "react";

import { DEFAULT_LOCK_AFTER, type LockAfter } from "./lock-rules";
import { readLockAfter, watchVault } from "./vault";

/** The lock time picked, kept current with every window. */
export function useLockAfter(): LockAfter {
  const [minutes, setMinutes] = useState<LockAfter>(DEFAULT_LOCK_AFTER);
  useEffect(() => {
    let live = true;
    const read = () =>
      void readLockAfter().then((value) => {
        if (live) setMinutes(value);
      });
    read();
    const stop = watchVault(read);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return minutes;
}
