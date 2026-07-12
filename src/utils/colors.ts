// Colour system (spec section 7). One fixed colour per geography, used
// everywhere, so the same place reads the same across every chart. Reason
// colours are grouped into families (health, school dissatisfaction,
// exclusion, lifestyle, data quality). Term colours are distinct.
//
// Semantic rule that MUST hold across the dashboard: rising EHE is NEUTRAL, not
// good or bad. Deltas render in neutral ink with an explicit +/- sign; no
// series or delta is ever coloured green-for-good / red-for-bad on the basis of
// direction.

// ----- geography roles -----------------------------------------------------
export type GeoRole =
  | 'england'
  | 'southWest'
  | 'cornwall'
  | 'plymouth'
  | 'devon'
  | 'footprint'
  | 'benchmark'
  | 'other'

export const GEO_COLORS: Record<GeoRole, string> = {
  england: '#475569', // slate, always dashed (the reference line)
  southWest: '#1d4ed8', // deep blue
  cornwall: '#d97706', // golden / amber
  plymouth: '#0d9488', // teal
  devon: '#059669', // green
  footprint: '#E94F37', // strong narrative red (matches the old app key-LA red)
  benchmark: '#94a3b8', // muted grey (Torbay / Somerset / Dorset)
  other: '#cbd5e1', // low-emphasis LA cloud
}

export function getGeoColor(role: GeoRole): string {
  return GEO_COLORS[role]
}

// England is always dashed (it is the reference line). Every other role is
// solid unless a chart overrides it.
export function getGeoDash(role: GeoRole): string | undefined {
  return role === 'england' ? '8 4' : undefined
}

// ----- reason families (spec section 7; ported from app.py REASON_COLORS) ---
// Families matter more than the exact hexes: health = blues, school
// dissatisfaction = oranges/yellows, exclusion = purples, lifestyle /
// philosophical = greens, and the data-quality set (Unknown / No reason given /
// Other) = the red-grey family, visually set apart from substantive reasons.
export type ReasonFamily =
  | 'health'
  | 'schoolDissatisfaction'
  | 'exclusion'
  | 'lifestyle'
  | 'dataQuality'

export const REASON_FAMILY_LABEL: Record<ReasonFamily, string> = {
  health: 'Health',
  schoolDissatisfaction: 'School dissatisfaction',
  exclusion: 'Exclusion related',
  lifestyle: 'Lifestyle and preference',
  dataQuality: 'Unknown / other (data quality)',
}

// Representative colour per family, used where a reason is grouped rather than
// shown individually.
export const REASON_FAMILY_COLORS: Record<ReasonFamily, string> = {
  health: '#2E86AB', // blue
  schoolDissatisfaction: '#F6AE2D', // orange
  exclusion: '#9C27B0', // purple
  lifestyle: '#4CAF50', // green
  dataQuality: '#E94F37', // red-grey data-quality family
}

// Per-reason colours, ported from the Dash app (app.py REASON_COLORS) so the
// same reason keeps the same hue as the old dashboard.
export const REASON_COLORS: Record<string, string> = {
  Unknown: '#E94F37',
  'No reason given': '#FF6B6B',
  'Mental health': '#2E86AB',
  'Physical health': '#5DA9E9',
  'Health concerns related to COVID19': '#89CFF0',
  'School dissatisfaction general': '#F6AE2D',
  'School dissatisfaction SEND': '#F4D35E',
  'School dissatisfaction bullying': '#FAA307',
  Lifestyle: '#4CAF50',
  'Philosophical or preferential': '#81C784',
  Religious: '#A5D6A7',
  'Risk of school exclusion': '#9C27B0',
  'Permanent exclusion': '#BA68C8',
  'Did not get school preference': '#7E57C2',
  'Difficulty accessing suitable school place': '#5C6BC0',
  'Offered school place but not yet accepted': '#42A5F5',
  'Did not apply for school place at compulsory school age': '#26A69A',
  'School suggestion': '#78909C',
  Other: '#8D6E63',
}

// Classify a reason name into its family. Substring matching keeps this robust
// to small label changes between releases.
export function getReasonFamily(reason: string): ReasonFamily {
  const r = reason.toLowerCase()
  if (r.includes('unknown') || r.includes('no reason') || r === 'other') return 'dataQuality'
  if (r.includes('health') || r.includes('covid')) return 'health'
  if (r.includes('exclusion') || r.includes('preference') || r.includes('school place') || r.includes('suggestion') || r.includes('accepted') || r.includes('apply'))
    return 'exclusion'
  if (r.includes('dissatisfaction') || r.includes('bullying') || r.includes('send')) return 'schoolDissatisfaction'
  if (r.includes('lifestyle') || r.includes('philosophical') || r.includes('preferential') || r.includes('religious'))
    return 'lifestyle'
  return 'dataQuality'
}

// Colour for a reason: its ported per-reason hue where known, otherwise the
// family colour.
export function getReasonColor(reason: string): string {
  return REASON_COLORS[reason] ?? REASON_FAMILY_COLORS[getReasonFamily(reason)]
}

// ----- term palette (spec section 7; old app: red / blue / green) ----------
export type Term = 'Autumn' | 'Spring' | 'Summer'

export const TERM_COLORS: Record<Term, string> = {
  Autumn: '#c0392b', // red
  Spring: '#2471a3', // blue
  Summer: '#27ae60', // green
}

// ----- deltas: neutral only ------------------------------------------------
// Rising EHE is neither good nor bad. Deltas use one neutral ink regardless of
// sign; the sign itself (from the formatSigned* helpers) carries the direction.
export const DELTA_INK = '#475569'

export function getDeltaColor(): string {
  return DELTA_INK
}
