// @flow
import type { TezosResources, TezosResourcesRaw } from "./types";

export function toTezosResourcesRaw(r: TezosResources): TezosResourcesRaw {
  const { revealed, publicKey, counter } = r;
  // FIXME this must be matching the type, otherwise it will break on LLD.
  return { revealed, publicKey, counter };
}

export function fromTezosResourcesRaw(r: TezosResourcesRaw): TezosResources {
  const { revealed, publicKey, counter } = r;
  return { revealed, publicKey, counter };
}