"use client";

// Which picture an address uses: one of its generated variants, or an uploaded
// one. Stored per address in localStorage, so a second wallet on the same
// browser keeps its own picture. Nothing leaves the device.

import { useSyncExternalStore } from "react";

export type AvatarPref = { kind: "generated"; variant: number } | { kind: "upload"; dataUrl: string };

const PREFIX = "thamba.avatar.";
const key = (address: string) => `${PREFIX}${address.toLowerCase()}`;

const DEFAULT: AvatarPref = { kind: "generated", variant: 0 };

// useSyncExternalStore needs a stable reference per key, so parsed values are
// cached and only re-parsed when something writes.
const cache = new Map<string, AvatarPref>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function parse(raw: string | null): AvatarPref {
  if (!raw) return DEFAULT;
  try {
    const v = JSON.parse(raw) as AvatarPref;
    if (v?.kind === "upload" && typeof v.dataUrl === "string") return v;
    if (v?.kind === "generated" && Number.isInteger(v.variant)) return v;
  } catch {}
  return DEFAULT;
}

function snapshot(address: string): AvatarPref {
  const k = key(address);
  const hit = cache.get(k);
  if (hit) return hit;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(k);
  } catch {}
  const v = parse(raw);
  cache.set(k, v);
  return v;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(PREFIX)) {
      cache.delete(e.key);
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setAvatarPref(address: string, pref: AvatarPref) {
  const k = key(address);
  try {
    localStorage.setItem(k, JSON.stringify(pref));
  } catch {}
  cache.set(k, pref);
  emit();
}

/** Back to the generated picture, variant 0. */
export function clearAvatarPref(address: string) {
  const k = key(address);
  try {
    localStorage.removeItem(k);
  } catch {}
  cache.set(k, DEFAULT);
  emit();
}

/**
 * The address's current choice. Server-rendered as the generated default so the
 * first client render matches; an uploaded picture appears right after mount.
 */
export function useAvatarPref(address: string | null): AvatarPref {
  return useSyncExternalStore(
    subscribe,
    () => (address ? snapshot(address) : DEFAULT),
    () => DEFAULT,
  );
}
