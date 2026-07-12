// Canonical view list (single source of truth, spec section 5).
// The sidebar and the App switch both derive from this.
import {
  Lightbulb,
  LineChart,
  Map as MapIcon,
  MapPin,
  MapPinned,
  ArrowLeftRight,
  GraduationCap,
  ListChecks,
  Table2,
  BookOpenText,
  type LucideIcon,
} from 'lucide-react'

export type ViewId =
  | 'headlines'
  | 'national'
  | 'regional'
  | 'footprint'
  | 'map'
  | 'flows'
  | 'yeargroups'
  | 'reasons'
  | 'explorer'
  | 'methodology'

export type ViewGroup = 'Start here' | 'Places' | 'Questions' | 'Reference'

export interface ViewMeta {
  id: ViewId
  label: string
  group: ViewGroup
  icon: LucideIcon
}

// Order and grouping are fixed by spec section 5. Do not reorder.
export const VIEWS: ViewMeta[] = [
  { id: 'headlines', label: 'EHE: What the Data Shows', group: 'Start here', icon: Lightbulb },
  { id: 'national', label: 'National', group: 'Places', icon: LineChart },
  { id: 'regional', label: 'Regional', group: 'Places', icon: MapIcon },
  { id: 'footprint', label: 'WeST Footprint', group: 'Places', icon: MapPin },
  { id: 'map', label: 'LA Map', group: 'Places', icon: MapPinned },
  { id: 'flows', label: 'Stocks, Flows and Enforcement', group: 'Questions', icon: ArrowLeftRight },
  { id: 'yeargroups', label: 'Year Groups', group: 'Questions', icon: GraduationCap },
  { id: 'reasons', label: 'Reasons', group: 'Questions', icon: ListChecks },
  { id: 'explorer', label: 'Data Explorer', group: 'Reference', icon: Table2 },
  { id: 'methodology', label: 'Methodology', group: 'Reference', icon: BookOpenText },
]

export const VIEW_GROUPS: ViewGroup[] = ['Start here', 'Places', 'Questions', 'Reference']

export const DEFAULT_VIEW: ViewId = 'headlines'

export function getView(id: ViewId): ViewMeta {
  const v = VIEWS.find((x) => x.id === id)
  if (!v) throw new Error(`Unknown view: ${id}`)
  return v
}
