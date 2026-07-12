// Shared types for the EHE dashboard.
//
// The authoritative shape of every processed JSON file is documented in
// scripts/DATA_SHAPES.md (owned by the data agent). View agents build against
// that document and load files via dataService.loadProcessed<T>. This file
// carries only the cross-cutting primitives every layer agrees on: the
// suppression-aware Cell value, the period model, geography levels, and the
// build Metadata contract.

// ----- suppression-aware values (spec section 3.2) -------------------------
// Every numeric cell in processed JSON is `{ v, f? }`. A suppressed cell has
// `v: null` and keeps its published symbol. `low` rounds to zero but is not
// zero; `x` is not available; `z` is not applicable. A real zero is `{ v: 0 }`
// with no flag and must render as "0", never "n/a".
export type SuppressFlag = 'low' | 'x' | 'z'

export interface Cell {
  v: number | null
  f?: SuppressFlag
}

// ----- period model (spec section 4.1: term is first-class) ----------------
export type Term = 'Autumn' | 'Spring' | 'Summer'

export interface Period {
  // Academic year label, e.g. "2025/26".
  year: string
  term: Term
  // Monotonic ordering key across the ten census term-points.
  sortKey: number
}

export type GeoLevel = 'National' | 'Regional' | 'Local authority' | 'Footprint'

// ----- build metadata (spec section 3.3, file 8) ---------------------------
// Written LAST by the preprocess; its presence gates dataService and the recon
// tests. `generated_at` is the IndexedDB cache version key.
export interface Metadata {
  generated_at: string
  source?: string
  source_url?: string
  release?: string
  census_periods?: Period[]
  annual_years?: string[]
  census_row_count?: number
  annual_row_count?: number
  // Any further fields the preprocess emits are read structurally by views.
  [key: string]: unknown
}
