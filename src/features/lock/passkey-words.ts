import type { PasskeyError } from "./passkey";

export const UNLOCK_FAILURE: Record<
  PasskeyError["code"],
  { readonly title: string; readonly body: string }
> = {
  cancelled: {
    title: "Your passkey didn't open it.",
    body: "The prompt was closed, or this device couldn't use the passkey. Try again, or connect with a code.",
  },
  unreadable: {
    title: "This device's passkey no longer opens it.",
    body: "The passkey was removed or replaced, so the panel forgot it. Connect with a code; you can turn passkey unlock on again after.",
  },
  unsupported: {
    title: "This device couldn't use the passkey.",
    body: "Connect with a code instead. Your private balance is as it was.",
  },
};

export const SAVE_FAILURE: Record<PasskeyError["code"], string> = {
  cancelled: "The passkey wasn't saved. Nothing changed.",
  unreadable: "The passkey wasn't saved. Nothing changed.",
  unsupported:
    "This device can't keep a key in a passkey, so the panel connects with a code after it locks.",
};
