// Runtime data-access layer (spec section 2; ported from the NEETS dashboard).
//
// This is the ONLY fetch boundary. View agents never fetch directly and never
// edit this file: they call loadMetadata() once and loadProcessed<T>(filename)
// for each processed JSON they need. The shape of each file is documented in
// scripts/DATA_SHAPES.md.
//
// Version-gate pattern:
//   - loadMetadata fetches /processed/metadata.json fresh and resolves the
//     current version (metadata.generated_at).
//   - loadProcessed awaits that version, serves the IndexedDB copy when the
//     versions match, otherwise fetches the network and writes back.
//   - A per-file in-memory Map short-circuits before IndexedDB.
//
// Before the preprocess has run there is no output, so loadMetadata resolves the
// version to null and loadProcessed returns null gracefully rather than
// throwing: a missing file degrades to an empty state, never a crash.

import type { Metadata } from '../types'
import { idbGet, idbSet, idbPurgeOtherVersions } from '../utils/idbCache'

const BASE = '/processed'

let versionResolver: ((v: string | null) => void) | null = null
const versionPromise: Promise<string | null> = new Promise((res) => {
  versionResolver = res
})

const memory = new Map<string, unknown>()

// Fetches /processed/metadata.json and resolves the cache version. Call once on
// app boot; loadProcessed awaits the version this establishes.
export async function loadMetadata(): Promise<Metadata | null> {
  try {
    const res = await fetch(`${BASE}/metadata.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`metadata ${res.status}`)
    const meta = (await res.json()) as Metadata
    versionResolver?.(meta.generated_at ?? null)
    if (meta.generated_at) void idbPurgeOtherVersions(meta.generated_at)
    return meta
  } catch {
    // No preprocess output yet or a transient failure: skip the cache for this
    // session and let loaders fall back to direct network.
    versionResolver?.(null)
    return null
  }
}

// Generic loader for any processed JSON file. Pass the bare filename, e.g.
// loadProcessed<Totals>('totals.json'). Returns null when the file is absent so
// a view can render an empty state rather than throwing.
export async function loadProcessed<T>(filename: string): Promise<T | null> {
  if (memory.has(filename)) return memory.get(filename) as T
  const version = await versionPromise
  if (version) {
    const cached = await idbGet<T>(filename)
    if (cached && cached.version === version) {
      memory.set(filename, cached.data)
      return cached.data
    }
  }
  try {
    const res = await fetch(`${BASE}/${filename}`)
    if (!res.ok) return null
    const data = (await res.json()) as T
    memory.set(filename, data)
    if (version) void idbSet(filename, version, data)
    return data
  } catch {
    return null
  }
}
