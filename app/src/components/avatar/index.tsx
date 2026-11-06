"use client";

// Profile pictures. Every address has a generated geometric picture (art.tsx);
// a person can pick a different variant of it or upload their own. The picture
// shows anywhere the signed-in person appears: app bar, desktop nav, Account.

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Sheet, cx } from "../ui";
import { GeneratedAvatar, VARIANT_COUNT } from "./art";
import { clearAvatarPref, setAvatarPref, useAvatarPref } from "./store";
import { ACCEPT, processUpload } from "./upload";

export { GeneratedAvatar, VARIANT_COUNT } from "./art";
export { useAvatarPref, setAvatarPref, clearAvatarPref } from "./store";

/** The picture for an address: the uploaded one if there is one, else generated. */
export function UserAvatar({ address, size = 36, className }: { address: string | null; size?: number; className?: string }) {
  const pref = useAvatarPref(address);
  return (
    <Ring size={size} className={className}>
      {!address ? null : pref.kind === "upload" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local data URL, never a remote file
        <img src={pref.dataUrl} alt="" aria-hidden className="size-full object-cover" />
      ) : (
        <GeneratedAvatar address={address} variant={pref.variant} size={size - 2} />
      )}
    </Ring>
  );
}

function Ring({ size, className, children }: { size: number; className?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block shrink-0 overflow-hidden rounded-full border border-line bg-surface-2", className)}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Edit sheet: the picture large, the generated variants to choose from, an
// upload, and a way back to the generated one.
// ---------------------------------------------------------------------------

const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function EditAvatarSheet({ open, onClose, address }: { open: boolean; onClose: () => void; address: string | null }) {
  const pref = useAvatarPref(address);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  // The sheet portals into document.body, which only exists on the client.
  const mounted = useSyncExternalStore(noSubscribe, onClient, onServer);

  if (!open || !mounted || !address) return null;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    const res = await processUpload(f);
    setBusy(false);
    if (res.ok) {
      setAvatarPref(address, { kind: "upload", dataUrl: res.dataUrl });
      setError(null);
    } else {
      setError(res.error);
    }
  };

  const variants = Array.from({ length: VARIANT_COUNT }, (_, i) => i);

  return createPortal(
    <Sheet open={open} onClose={onClose} title="Edit profile picture">
      <div className="flex justify-center py-2">
        <UserAvatar address={address} size={96} />
      </div>

      <p className="t-label mt-2 text-center">
        {pref.kind === "upload" ? "Your own picture" : "Made from your account, so it is always the same"}
      </p>

      <p className="t-list-title mt-5 text-text">Choose a picture</p>
      <div role="radiogroup" aria-label="Generated profile pictures" className="mt-2 grid grid-cols-4 gap-2">
        {variants.map((v) => {
          const selected = pref.kind === "generated" && pref.variant === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Picture ${v + 1} of ${VARIANT_COUNT}`}
              onClick={() => {
                setAvatarPref(address, { kind: "generated", variant: v });
                setError(null);
              }}
              className={cx(
                "flex h-14 items-center justify-center rounded-[10px] border",
                selected ? "border-line-strong bg-surface-2" : "border-transparent hover:bg-surface-2",
              )}
            >
              <GeneratedAvatar address={address} variant={v} size={44} />
            </button>
          );
        })}
      </div>

      <input
        ref={file}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button variant="secondary" size="bar" className="mt-5 w-full" busy={busy} onClick={() => file.current?.click()}>
        {busy ? "Working on it" : "Upload a picture"}
      </Button>
      <p className="t-caption mt-2">PNG, JPG, WEBP or SVG, under 2 MB. It is saved on this device only.</p>

      {error && <p className="t-label mt-3 text-loss-text">{error}</p>}

      {pref.kind === "upload" && (
        <button
          type="button"
          onClick={() => {
            clearAvatarPref(address);
            setError(null);
          }}
          className="t-change-sm mt-3 flex h-12 items-center text-gain-text"
        >
          Use generated picture
        </button>
      )}
    </Sheet>,
    document.body,
  );
}
