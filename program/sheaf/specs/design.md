# Design Spec — Sheaf

> **Phase:** design  
> **Status:** draft for builder approval  
> **Sources:** `./program/sheaf/specs/idea.md`, `./program/sheaf/specs/requirements.md`

Sheaf should feel like a dependable field notebook rather than a spreadsheet
wearing a mobile skin. The shell is quiet, tactile, and recognisable. A
generated app is allowed to feel like its owner's own tool. Integrity states
are written as facts, not reduced to coloured dots, and the user can always
see what is local, what is durable, and what still needs a decision.

---

## Experience Principles

1. **A useful result in one thumb's reach.** Upload is the only dominant shell
   action. Inside a generated app, the dominant action belongs to that app:
   add a record, open today's work, or act on a chart.
2. **Plain language before system language.** The interface says *Customers
   links to Orders through Customer ID* only when explaining evidence. The
   primary copy says *Each order belongs to one customer.*
3. **Integrity is visible, never theatrical.** Backup age, device-only change
   count, scratch state, capacity state, broken references, and conflicts are
   persistent textual facts. Success chrome stays quiet; risk chrome becomes
   specific and actionable.
4. **The shell and generated apps are visibly different layers.** Sheaf owns
   the library, import, adoption, security, and durability. Each generated app
   owns its theme, logo, information hierarchy, tables, forms, and charts.
5. **Phone first means redesign, not shrink.** Phone uses cards, bottom sheets,
   sticky controls, and a bottom navigation bar. Tablet landscape earns a
   list/detail split. Desktop earns a dense table and persistent utility rail.
6. **Destructive choices begin with facts and remedies.** Before reset,
   removal, or delete-everywhere, show what is known, say what cannot be known,
   offer backup/bundle/export where possible, then ask for confirmation.
7. **Unsupported never means disappeared.** Inert workbook content, bad
   values, broken references, unavailable baselines, and omitted results are
   named where they occur and lead to an explanation or remedy.
8. **Offline is normal.** Online success is never the dominant visual state.
   The app calls attention only to work that exists on this device and has not
   yet reached its durable home.

---

## Design Language

### Brand character

**Field notebook + precise instrument.** Warm paper surfaces and editorial
headings make the product approachable; dark ink, ruled separators, tabular
numbers, and compact status language make it trustworthy. A three-layer
"bound sheets" mark is the sole literal use of the sheaf metaphor.

Avoid spreadsheet-grid nostalgia, glossy SaaS gradients, glass effects,
floating decorative blobs, and large empty hero areas. Data is the visual
material.

### Color palette

| Token | Value | Use |
|---|---:|---|
| Ink 950 | `#17211C` | Primary text, dark app chrome |
| Ink 800 | `#2B3932` | Secondary dark surfaces |
| Paper 50 | `#F7F5EE` | Shell canvas |
| Paper 100 | `#EFECE2` | Subtle panels and rails |
| Paper 200 | `#E2DED2` | Dividers and disabled fills |
| White | `#FFFDF8` | Raised cards and inputs |
| Leaf 700 | `#2D5A4B` | Shell primary action and focus |
| Leaf 500 | `#4F7D6C` | Secondary shell accents |
| Sprout 300 | `#CBEA80` | Selected controls on dark ink |
| Clay 600 | `#A84F32` | Destructive action and hard errors |
| Marigold 500 | `#C78316` | Stale, scratch, and warning emphasis |
| River 600 | `#396B8C` | Informational and adoption states |
| Violet 600 | `#705B91` | Secondary chart series only |

Text and icons always accompany semantic color. Filled semantic badges use a
dark text colour and a pale tint; they do not rely on hue alone.

### Per-app theming contract

Generated apps remap a small semantic set rather than styling every element
independently:

| App token | Purpose |
|---|---|
| `app-ink` | Navigation and strong text |
| `app-canvas` | Main background |
| `app-surface` | Cards and form controls |
| `app-primary` | Primary action and selected state |
| `app-accent` | Charts, highlights, and focus details |
| `app-muted` | Dividers and secondary surfaces |

Danger, warning, success, focus visibility, and readable contrast remain Sheaf
system semantics and cannot be made ambiguous by a theme. The mocks use
**Cedar & Finch Fieldbook** as the generated-app example: charcoal
`#17231E`, moss `#315C49`, citrus `#D7F28A`, cream `#F5F1E7`, and clay
`#C66948`. Other library tiles deliberately use different identities.

### Typography

- **Display / app identity:** `Charter`, `Iowan Old Style`, `Georgia`, serif.
  Use sparingly for the Sheaf wordmark, screen titles, and app identity.
- **Interface / body:** `Avenir Next`, `Segoe UI`, `Helvetica Neue`, sans-serif.
- **Data:** the interface family with `font-variant-numeric: tabular-nums`.
- **Type scale:** 12 caption, 14 supporting, 16 body/control, 20 section title,
  28 page title, 36 desktop display. Body never falls below 16px in editable
  controls to prevent mobile zoom and protect readability.
- **Weights:** 450 body where supported, 600 controls, 700 status and page
  hierarchy. Weight, icon, and copy reinforce state; colour alone never does.

### Spacing system

- **Base unit:** 4px.
- **Scale:** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Phone gutter:** 16px; **wide phone/tablet:** 24px; **desktop:** 32px.
- Dense tables may use 12px vertical cell padding. Touch controls retain a
  minimum 44px hit area even when their visual mark is smaller.

### Shape

- **Controls:** 10px radius.
- **Cards:** 16px radius.
- **Prominent panels / sheets:** 22px radius.
- **Pills:** full radius, used only for filters, compact status, and segmented
  selection.
- **Brand mark and charts:** slightly imperfect offsets and ruled details make
  the product feel made, not generated; core controls remain geometrically
  precise.

### Shadow and borders

- **Level 0:** 1px `Paper 200` border; default for most cards.
- **Level 1:** `0 8px 24px rgba(23,33,28,.08)`; menus and sticky phone bars.
- **Level 2:** `0 20px 60px rgba(23,33,28,.16)`; dialogs and bottom sheets.
- Use shadows to explain layering, never as decoration. Data regions use ruled
  borders rather than floating-card stacks.

### Iconography and illustration

- Rounded 1.75px line icons, paired with text for any consequential action.
- Provider marks may use their official assets in implementation; the mocks
  use labelled monograms so they do not imply bundled third-party assets.
- No decorative photography is required. Workbook names, counts, charts, and
  app themes provide the visual interest and keep offline behavior honest.

### Motion

- 120–180ms for press, selection, and field feedback; 220–280ms for panels.
- Import progress moves continuously but does not pulse the entire screen.
- Recalculated values briefly underline rather than flash.
- Respect reduced-motion preference; no required information depends on an
  animation completing.

---

## Layout Classes

| Class | Width | Contract |
|---|---:|---|
| Compact phone | 320–599px | One column, 16px gutter, sticky bottom action/navigation, horizontal chip scrollers, stacked comparisons |
| Wide phone / portrait tablet | 600–899px | Two-column cards where independent; forms remain one readable column; 24px gutter |
| Tablet landscape | 900–1199px | 88px Sheaf/app rail plus list/detail split; detail remains visible while list scrolls |
| Desktop | 1200px+ | 248px labelled rail, dense tables, two- or three-pane workspaces, max content width 1600px |

Safe-area insets extend bottom bars and sheets. Sticky regions must never cover
focused inputs or the last record. At every class, users can reach the same
actions and read the same status text; density changes, capability does not.

---

## Exhaustive Control Inventory

Every interactive or state-bearing control has a stable ID. A control may be
reused on many screens, but its complete visual/state contract lives in
`./program/sheaf/mocks/control-atlas.html`. No implementation-only control may
be introduced without adding it here or obtaining a design-fill/design-change
under the Genesis re-entry rules.

| ID | Control | Required variants and states | Family | Mock source |
|---|---|---|---|---|
| CTL-001 | Bound-sheets mark | light, dark, monochrome, 16/24/32px | Brand & identity | `./program/sheaf/mocks/control-atlas.html#ctl-001` |
| CTL-002 | Sheaf wordmark | full, compact mark-only | Brand & identity | `./program/sheaf/mocks/control-atlas.html#ctl-002` |
| CTL-003 | Generated-app logo / monogram | uploaded image, initials fallback, missing image | Brand & identity | `./program/sheaf/mocks/control-atlas.html#ctl-003` |
| CTL-004 | Shell top bar | phone, tablet, desktop; default, search open | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-004` |
| CTL-005 | Generated-app top bar | phone, tablet, desktop; backup/conflict badges | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-005` |
| CTL-006 | Tablet icon rail | selected, idle, badge, locked | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-006` |
| CTL-007 | Desktop labelled rail | selected, idle, badge, locked | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-007` |
| CTL-008 | Phone bottom navigation | selected, idle, badge, safe-area padded | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-008` |
| CTL-009 | Back / close control | back, close, cancel-safe | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-009` |
| CTL-010 | Context breadcrumb | shell → app → table; truncation | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-010` |
| CTL-011 | Tabs | selected, idle, count, overflow | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-011` |
| CTL-012 | Review anchor navigation | current, completed, warning count | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-012` |
| CTL-013 | Primary floating add action | default, pressed, focus, disabled | Navigation | `./program/sheaf/mocks/control-atlas.html#ctl-013` |
| CTL-014 | Primary button | default, hover, pressed, focus, busy, disabled | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-014` |
| CTL-015 | App-bright primary button | dark-chrome variant; default through disabled | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-015` |
| CTL-016 | Secondary button | default, hover, pressed, focus, disabled | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-016` |
| CTL-017 | Ghost / text button | default, hover, focus, disabled | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-017` |
| CTL-018 | Danger button | default, focus, busy, disabled | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-018` |
| CTL-019 | Icon button | default, hover, focus, disabled; accessible name required | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-019` |
| CTL-020 | Inline link | default, visited-neutral, hover, focus, external handoff | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-020` |
| CTL-021 | Full-width phone action | single, paired, wrapping label | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-021` |
| CTL-022 | Loading action | spinner, progress label, cancellation available/unavailable | Actions | `./program/sheaf/mocks/control-atlas.html#ctl-022` |
| CTL-023 | Text input | empty, filled, focus, read-only, invalid, disabled | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-023` |
| CTL-024 | Multiline text area | empty, filled, focus, invalid, read-only | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-024` |
| CTL-025 | Sticky search field | idle, typing, populated, no results, clearing | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-025` |
| CTL-026 | Passphrase input | empty, revealed, hidden, invalid, delayed | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-026` |
| CTL-027 | Show / hide secret control | show, hide, focus | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-027` |
| CTL-028 | Recovery-code input | grouped entry, pasted, invalid, accepted | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-028` |
| CTL-029 | Typed confirmation phrase | empty, mismatch, match | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-029` |
| CTL-030 | Number input | numeric keyboard, decimal, negative allowed/forbidden, invalid | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-030` |
| CTL-031 | Currency input | symbol prefix, locale formatting, invalid original preserved | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-031` |
| CTL-032 | Date input | native picker, empty, filled, invalid relationship | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-032` |
| CTL-033 | Phone input + dial action | editing, valid, invalid, dial handoff | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-033` |
| CTL-034 | Email input | email keyboard, valid, invalid | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-034` |
| CTL-035 | URL input | URL keyboard, valid, invalid, open handoff | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-035` |
| CTL-036 | Address input + maps action | editing, valid, open-maps handoff | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-036` |
| CTL-037 | Boolean switch | on, off, focus, disabled, indeterminate import | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-037` |
| CTL-038 | Enum picker field | empty, populated, open, invalid option | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-038` |
| CTL-039 | Reference picker field | empty, populated, open, missing related record | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-039` |
| CTL-040 | Native file-pick trigger | idle, chosen, unavailable, drag alternative | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-040` |
| CTL-041 | Workbook drop zone | empty, drag-over, chosen, unsupported | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-041` |
| CTL-042 | Select field | empty, selected, open-native, invalid, disabled | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-042` |
| CTL-043 | Checkbox | unchecked, checked, mixed, focus, disabled | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-043` |
| CTL-044 | Radio choice | unchecked, checked, focus, disabled | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-044` |
| CTL-045 | Segmented choice | selected, idle, disabled, overflow | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-045` |
| CTL-046 | Reorder handle / row | idle, dragging, keyboard move, fixed item | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-046` |
| CTL-047 | Formula editor | valid, recalculating, unsupported function, empty flagged | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-047` |
| CTL-048 | Logo upload / remove | empty, preview, replacing, failed | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-048` |
| CTL-049 | Theme colour swatch | selected, idle, custom colour, contrast failure | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-049` |
| CTL-050 | Density selector | comfortable, compact, preview | Inputs | `./program/sheaf/mocks/control-atlas.html#ctl-050` |
| CTL-051 | Filter chip | available, active, removable, disabled | Query | `./program/sheaf/mocks/control-atlas.html#ctl-051` |
| CTL-052 | Enum filter control | single, multiple, none | Query | `./program/sheaf/mocks/control-atlas.html#ctl-052` |
| CTL-053 | Date-range filter control | start, end, open-ended, invalid range | Query | `./program/sheaf/mocks/control-atlas.html#ctl-053` |
| CTL-054 | Numeric / currency filter | minimum, maximum, open-ended, invalid | Query | `./program/sheaf/mocks/control-atlas.html#ctl-054` |
| CTL-055 | Boolean filter | either, yes, no | Query | `./program/sheaf/mocks/control-atlas.html#ctl-055` |
| CTL-056 | Reference filter | search, selected related record, broken reference | Query | `./program/sheaf/mocks/control-atlas.html#ctl-056` |
| CTL-057 | Sort control | ascending, descending, unsorted; any column | Query | `./program/sheaf/mocks/control-atlas.html#ctl-057` |
| CTL-058 | Clear-one / clear-all filters | enabled, disabled | Query | `./program/sheaf/mocks/control-atlas.html#ctl-058` |
| CTL-059 | Table switcher | current table, counts, horizontal overflow | Query | `./program/sheaf/mocks/control-atlas.html#ctl-059` |
| CTL-060 | Present app tile | default, current backup, device-only changes | App tiles | `./program/sheaf/mocks/control-atlas.html#ctl-060` |
| CTL-061 | Scratch app tile | persistent text badge, escalating reminder | App tiles | `./program/sheaf/mocks/control-atlas.html#ctl-061` |
| CTL-062 | Conflict app tile | pending count, open queue | App tiles | `./program/sheaf/mocks/control-atlas.html#ctl-062` |
| CTL-063 | Stale-backup app tile | last confirmed time, failure cause, remedy | App tiles | `./program/sheaf/mocks/control-atlas.html#ctl-063` |
| CTL-064 | Oversized-local app tile | entry disabled; export/backup/remove available | App tiles | `./program/sheaf/mocks/control-atlas.html#ctl-064` |
| CTL-065 | Listed-only app tile | not local; adopt/larger-device actions only | App tiles | `./program/sheaf/mocks/control-atlas.html#ctl-065` |
| CTL-066 | Record card | default, selected, conflict, deleted, broken reference | Data | `./program/sheaf/mocks/control-atlas.html#ctl-066` |
| CTL-067 | Dense data table | sticky header, sort, filter, selected row, omitted rows | Data | `./program/sheaf/mocks/control-atlas.html#ctl-067` |
| CTL-068 | Selectable list row | default, selected, hover, keyboard focus | Data | `./program/sheaf/mocks/control-atlas.html#ctl-068` |
| CTL-069 | Relationship strip | parent, children, empty, broken | Data | `./program/sheaf/mocks/control-atlas.html#ctl-069` |
| CTL-070 | Human reference label | normal, loading local value, missing | Data | `./program/sheaf/mocks/control-atlas.html#ctl-070` |
| CTL-071 | Broken-reference treatment | plain-language flag, original key disclosure, repair | Data | `./program/sheaf/mocks/control-atlas.html#ctl-071` |
| CTL-072 | Metric card | current, recalculating, partial, error | Data | `./program/sheaf/mocks/control-atlas.html#ctl-072` |
| CTL-073 | Computed value | current, recalculating, clock-live, frozen, unsupported | Data | `./program/sheaf/mocks/control-atlas.html#ctl-073` |
| CTL-074 | Chart canvas | bar, line, pie, scatter, stacked; light/dark | Charts | `./program/sheaf/mocks/control-atlas.html#ctl-074` |
| CTL-075 | Touch chart mark | idle, hover, selected/filtering, keyboard focus | Charts | `./program/sheaf/mocks/control-atlas.html#ctl-075` |
| CTL-076 | Chart legend | series, hidden series, selected series | Charts | `./program/sheaf/mocks/control-atlas.html#ctl-076` |
| CTL-077 | Chart text/table alternative | summary, complete data, named partial data | Charts | `./program/sheaf/mocks/control-atlas.html#ctl-077` |
| CTL-078 | Snapshot row | normal, classified use, inert-content count | Data | `./program/sheaf/mocks/control-atlas.html#ctl-078` |
| CTL-079 | Preserved-inert marker | type, reason, original location, limitation | Data | `./program/sheaf/mocks/control-atlas.html#ctl-079` |
| CTL-080 | Semantic status badge | good, scratch, stale, offline, conflict, inert, broken | Status | `./program/sheaf/mocks/control-atlas.html#ctl-080` |
| CTL-081 | Persistent banner | information, warning, danger, success; action/no action | Status | `./program/sheaf/mocks/control-atlas.html#ctl-081` |
| CTL-082 | Inline field validation | error, warning, corrected | Status | `./program/sheaf/mocks/control-atlas.html#ctl-082` |
| CTL-083 | Record validation summary | column-level, cross-field, merge-level | Status | `./program/sheaf/mocks/control-atlas.html#ctl-083` |
| CTL-084 | Toast | saved locally, backup confirmed, queued offline, restored, error | Status | `./program/sheaf/mocks/control-atlas.html#ctl-084` |
| CTL-085 | Skeleton | tile, card, table; no decrypted-content silhouette while locked | Status | `./program/sheaf/mocks/control-atlas.html#ctl-085` |
| CTL-086 | Empty state | library, table, search, chart, conflicts, history | Status | `./program/sheaf/mocks/control-atlas.html#ctl-086` |
| CTL-087 | Error state | recoverable, blocked input, provider, storage, unknown local | Status | `./program/sheaf/mocks/control-atlas.html#ctl-087` |
| CTL-088 | Determinate / indeterminate progress | pre-flight, import, adoption, backup | Status | `./program/sheaf/mocks/control-atlas.html#ctl-088` |
| CTL-089 | Step indicator | upcoming, current, complete, error; keyboard-scrollable | Status | `./program/sheaf/mocks/control-atlas.html#ctl-089` |
| CTL-090 | Backup ledger | current, pending, offline, failed, scratch, bundle stale | Durability | `./program/sheaf/mocks/control-atlas.html#ctl-090` |
| CTL-091 | Adaptive budget meter | within, approaching, degraded, over, not evaluated | Capacity | `./program/sheaf/mocks/control-atlas.html#ctl-091` |
| CTL-092 | Device-only change count | zero, nonzero, unknown while locked | Durability | `./program/sheaf/mocks/control-atlas.html#ctl-092` |
| CTL-093 | Offline state label | normal offline, queued, signed-out provider | Durability | `./program/sheaf/mocks/control-atlas.html#ctl-093` |
| CTL-094 | Durable-home provider card | available, connected, reconnect, conditional, unavailable | Durability | `./program/sheaf/mocks/control-atlas.html#ctl-094` |
| CTL-095 | Provider capability facts | discovery, isolation, automatic/manual, account label | Durability | `./program/sheaf/mocks/control-atlas.html#ctl-095` |
| CTL-096 | Recovery-code card | hidden, revealed, copied, printed, confirmed saved | Security | `./program/sheaf/mocks/control-atlas.html#ctl-096` |
| CTL-097 | Secret-scope label | local device, named durable-home vault | Security | `./program/sheaf/mocks/control-atlas.html#ctl-097` |
| CTL-098 | Passphrase strength / match | weak, sufficient, mismatch, matched | Security | `./program/sheaf/mocks/control-atlas.html#ctl-098` |
| CTL-099 | Encrypted-vs-plaintext callout | local, durable home, export exception | Security | `./program/sheaf/mocks/control-atlas.html#ctl-099` |
| CTL-100 | Destructive consequences list | known inventory, encrypted unknowns, survivor facts | Security | `./program/sheaf/mocks/control-atlas.html#ctl-100` |
| CTL-101 | Conflict queue item | field, key/FK, delete/edit, record, schema, baseline-absent | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-101` |
| CTL-102 | Baseline card | available value/time, unavailable explanation | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-102` |
| CTL-103 | Source comparison card | local, other device, upload; changed/unchanged/chosen | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-103` |
| CTL-104 | Conflict resolution choice | per-field, whole-row, no default for key/delete | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-104` |
| CTL-105 | Whole-record resolver | source A, source B, edit-valid-result | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-105` |
| CTL-106 | Conflict repair editor | invalid, corrected, valid | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-106` |
| CTL-107 | Applied-log row | collapsed, expanded with baseline and validation | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-107` |
| CTL-108 | Deletion marker notice | zero local changes, rescue required, acknowledged | Conflict | `./program/sheaf/mocks/control-atlas.html#ctl-108` |
| CTL-109 | Modal container | standard, wide compare, full-height compact phone | Overlays | `./program/sheaf/mocks/control-atlas.html#ctl-109` |
| CTL-110 | Alert-dialog container | destructive, typed confirmation, non-dismissible | Overlays | `./program/sheaf/mocks/control-atlas.html#ctl-110` |
| CTL-111 | Bottom-sheet container | half, full, keyboard raised, safe-area padded | Overlays | `./program/sheaf/mocks/control-atlas.html#ctl-111` |
| CTL-112 | Popover / action menu | open, keyboard focus, disabled item | Overlays | `./program/sheaf/mocks/control-atlas.html#ctl-112` |
| CTL-113 | Disclosure / accordion | closed, open, error count | Overlays | `./program/sheaf/mocks/control-atlas.html#ctl-113` |
| CTL-114 | Context action menu | app, record, chart, field | Overlays | `./program/sheaf/mocks/control-atlas.html#ctl-114` |
| CTL-115 | Theme palette control | built-in, custom, contrast warning | Theme & export | `./program/sheaf/mocks/control-atlas.html#ctl-115` |
| CTL-116 | Light/dark mode control | light, dark, follow device preview | Theme & export | `./program/sheaf/mocks/control-atlas.html#ctl-116` |
| CTL-117 | Logo preview control | initials, uploaded bitmap, removed | Theme & export | `./program/sheaf/mocks/control-atlas.html#ctl-117` |
| CTL-118 | Export-format card | XLSX, CSV, PNG, PDF; available/unavailable | Theme & export | `./program/sheaf/mocks/control-atlas.html#ctl-118` |
| CTL-119 | Plaintext acknowledgement | unchecked, checked, required action wording | Theme & export | `./program/sheaf/mocks/control-atlas.html#ctl-119` |
| CTL-120 | Install education card | eligible, installed, prompt unavailable, dismissed | Install | `./program/sheaf/mocks/control-atlas.html#ctl-120` |

## Exhaustive Surface Inventory

**Exhaustive means exhaustive:** every product-owned full screen, modal,
bottom sheet, popover, and persistent semantic state named by the approved
requirements has an ID and a rendered source below. Architect and later build
sessions may compose these surfaces, but may not invent an unnamed product
surface. Native/provider-owned UI is listed separately so handoffs are explicit
without pretending Sheaf controls those pixels.

### Product-owned full screens

| ID | Screen | Mock file | Contract | Requirements |
|---|---|---|---|---|
| SCR-001 | Welcome / product promise | `./program/sheaf/mocks/welcome.html` | First run before local encryption exists; no account or network requirement | FR-20, FR-22 |
| SCR-002 | Protect this device + local code | `./program/sheaf/mocks/setup.html` | Create local unlock; issue and confirm the local recovery code | FR-22–24 |
| SCR-003 | Cold unlock | `./program/sheaf/mocks/unlock.html` | No decrypted inventory; offline unlock, delay, recovery, reset routes | FR-20, FR-22–23 |
| SCR-004 | Local recovery entry | `./program/sheaf/mocks/local-recovery.html` | Enter the code scoped to this device and set a replacement passphrase | FR-22–23 |
| SCR-005 | Security settings | `./program/sheaf/mocks/security-settings.html` | Idle timeout, lock now, passphrase, and code access | FR-22–23 |
| SCR-006 | Change local passphrase | `./program/sheaf/mocks/passphrase-change.html` | Current secret required; re-wrap with no data loss | FR-23 |
| SCR-007 | Recovery-code centre | `./program/sheaf/mocks/recovery-codes.html` | Local and per-home codes, each with exact scope | FR-23–24 |
| SCR-008 | Locked reset | `./program/sheaf/mocks/reset.html` | Generic three-stage reset with no plaintext inventory | FR-22–23 |
| SCR-009 | Readable reset | `./program/sheaf/mocks/reset-unlocked.html` | Named apps/counts/backup ages/device-only changes and remedies | FR-23, FR-26 |
| SCR-010 | Populated library | `./program/sheaf/mocks/library.html` | All app tile states, upload, freshness, and launch destination | FR-19, FR-25–26, FR-30, FR-34 |
| SCR-011 | Empty library | `./program/sheaf/mocks/library-empty.html` | First upload, adoption, and install education without fictional data | FR-19–20, FR-30 |
| SCR-012 | Library search | `./program/sheaf/mocks/library-search.html` | Search across local and listed apps; no-result state | FR-19, FR-30 |
| SCR-013 | Install Sheaf | `./program/sheaf/mocks/install.html` | Experience benefit without claiming installation creates durability | FR-20 |
| SCR-014 | Connected durable homes | `./program/sheaf/mocks/durable-homes.html` | Multiple same-person accounts, strict isolation, reconnect/disconnect | FR-21, FR-24, FR-30 |
| SCR-015 | New apps discovered | `./program/sheaf/mocks/discovery.html` | Continuously found listed-only apps with metadata and selective adoption | FR-19, FR-30 |
| SCR-016 | Upload landing | `./program/sheaf/mocks/upload.html` | Device/picker/share sources, content detection, accepted formats | FR-1–2 |
| SCR-017 | Delimited-text target | `./program/sheaf/mocks/delimited-import.html` | Create a new app or add value-only table to an existing app | FR-1 |
| SCR-018 | Pre-flight: fits | `./program/sheaf/mocks/import.html` | Metadata-only sizing and sheet selection before cell parse | FR-1, FR-3 |
| SCR-019 | Pre-flight: too large | `./program/sheaf/mocks/import-large.html` | Subset selection and truthful desktop handoff | FR-3, FR-10, FR-34 |
| SCR-020 | Streaming import | `./program/sheaf/mocks/import-progress.html` | Current sheet, determinate progress, cancellation, local-only facts | FR-3 |
| SCR-021 | Import refused | `./program/sheaf/mocks/import-refused.html` | Macro and unsupported-format remedies; no partial app | FR-2 |
| SCR-022 | Import failed / cancelled | `./program/sheaf/mocks/import-failed.html` | Failure reason, cleanup confirmation, retry/choose-another actions | FR-2–3 |
| SCR-023 | Single import review | `./program/sheaf/mocks/review.html` | All inferences, evidence, preserved content, explicit acceptance | FR-4–9, FR-14 |
| SCR-024 | Generated-app home | `./program/sheaf/mocks/app-home.html` | Distinct identity, metrics, chart, tables, backup facts | FR-11, FR-14, FR-16–17, FR-25–26 |
| SCR-025 | Records / query surface | `./program/sheaf/mocks/records.html` | Phone cards, tablet split, desktop table, search/filter/sort | FR-11, FR-13, FR-34 |
| SCR-026 | Records empty / no results | `./program/sheaf/mocks/records-empty.html` | Truly empty table and filtered no-result variants | FR-12–13 |
| SCR-027 | Record detail | `./program/sheaf/mocks/record-detail.html` | Typed read view, relationships in both directions, handoffs, broken state | FR-11–12 |
| SCR-028 | Create record | `./program/sheaf/mocks/record-create.html` | All input types, validation, thumb-zone save, scratch trigger | FR-12, FR-25 |
| SCR-029 | Edit record | `./program/sheaf/mocks/record-edit.html` | Typed edits, live computed fields, column/record validation | FR-11–12, FR-14 |
| SCR-030 | Sheet snapshots | `./program/sheaf/mocks/snapshots.html` | Every original sheet and its interactive/read-only classification | FR-5, FR-9 |
| SCR-031 | Snapshot viewer | `./program/sheaf/mocks/snapshot-detail.html` | Read-only preserved content and explicit inert-item markers | FR-4–5, FR-9 |
| SCR-032 | Change history | `./program/sheaf/mocks/change-history.html` | Append-only visible history, deleted-record recovery, audit facts | FR-12, FR-28 |
| SCR-033 | Chart detail | `./program/sheaf/mocks/chart-detail.html` | Touch selection, filtered list, summary/table alternative, partial state | FR-13, FR-16, FR-34 |
| SCR-034 | Chart builder | `./program/sheaf/mocks/chart-builder.html` | All five chart types, relationships, save, pin, preview budget | FR-16, FR-34 |
| SCR-035 | App structure editor | `./program/sheaf/mocks/schema.html` | Types, enums, relationships, formulas, rules, counted impact | FR-12, FR-14–15 |
| SCR-036 | Theme editor | `./program/sheaf/mocks/theme.html` | Colour, accent, density, mode, logo, accessible preview | FR-17 |
| SCR-037 | App settings | `./program/sheaf/mocks/app-settings.html` | Name, re-upload, snapshots, theme, durability, export, safety | FR-15, FR-17–18, FR-25–26, FR-31, FR-33 |
| SCR-038 | Choose durable home | `./program/sheaf/mocks/durable-home.html` | Providers/bundle, privacy, iCloud exclusion, conditional Drive | FR-21, FR-23–27, FR-30 |
| SCR-039 | Backup detail | `./program/sheaf/mocks/backup-detail.html` | Confirmed freshness, queue, failure causes, automatic/manual behavior | FR-25–29 |
| SCR-040 | Adopt app selection | `./program/sheaf/mocks/adopt.html` | Index metadata only, pre-download sizing, selective lazy choice | FR-24, FR-30, FR-34 |
| SCR-041 | Adoption progress / complete | `./program/sheaf/mocks/adopt-progress.html` | Payload transfer, local validation, capacity abort, no review | FR-20, FR-27, FR-30 |
| SCR-042 | Capacity door | `./program/sheaf/mocks/capacity.html` | Oversized-local versus listed-only and five separate budgets | FR-18–19, FR-30, FR-34 |
| SCR-043 | Re-upload start | `./program/sheaf/mocks/reupload-start.html` | User-initiated newer file, source not watched or written back | FR-29, FR-31 |
| SCR-044 | Row identity matching | `./program/sheaf/mocks/reupload-identity.html` | Detected key, choose match column, new-table fallback, identity conflicts | FR-31 |
| SCR-045 | Re-upload review | `./program/sheaf/mocks/reupload-review.html` | Matched/new/absent rows, no automatic deletion, baseline status | FR-28, FR-31–32 |
| SCR-046 | Conflict queue + field/record resolution | `./program/sheaf/mocks/conflicts.html` | Three-way compare, baseline absent, invalid whole record, pending/applied | FR-28–32 |
| SCR-047 | Key, delete, and schema conflicts | `./program/sheaf/mocks/conflict-special.html` | No defaults for key/FK or delete/edit; schema compatibility | FR-31–32 |
| SCR-048 | Applied merge log | `./program/sheaf/mocks/applied-log.html` | Auditable one-sided/different-field automatic merges and validation | FR-29, FR-32 |
| SCR-049 | Data safety hub | `./program/sheaf/mocks/export-remove.html` | Export/removal/deletion choices and location-specific facts | FR-18, FR-26, FR-33 |
| SCR-050 | Export | `./program/sheaf/mocks/export.html` | XLSX/CSV/PNG/PDF scope and plaintext acknowledgement | FR-18, FR-34 |
| SCR-051 | Remove from device | `./program/sheaf/mocks/remove.html` | Routine versus destructive removal with recomputed freshness | FR-18, FR-26, FR-33 |
| SCR-052 | Deletion marker on reconnect | `./program/sheaf/mocks/deletion-marker.html` | Zero-change notice and device-only rescue path; no resurrection | FR-18, FR-33 |

### Modal and alert-dialog inventory

Every modal below is rendered in `./program/sheaf/mocks/dialog-atlas.html` at
its matching lowercase anchor. Compact-phone behavior promotes wide comparison
dialogs to full-height sheets without changing their decision contract.

| ID | Modal / alert dialog | Contract | Mock source | Requirements |
|---|---|---|---|---|
| MOD-001 | First scratch change reminder | Non-blocking durable-home choice after first authored change | `./program/sheaf/mocks/dialog-atlas.html#mod-001` | FR-12, FR-25 |
| MOD-002 | Escalated scratch reminder | Repeated warning with persistent dismissal and exact local-change count | `./program/sheaf/mocks/dialog-atlas.html#mod-002` | FR-25–26 |
| MOD-003 | Install education | Ask for install for experience only; never claim safety | `./program/sheaf/mocks/dialog-atlas.html#mod-003` | FR-20 |
| MOD-004 | Content/extension mismatch | Name detected format and contradictory extension | `./program/sheaf/mocks/dialog-atlas.html#mod-004` | FR-1 |
| MOD-005 | Macro refusal | Name file/macros, refuse wholly, offer macro-free remedy | `./program/sheaf/mocks/dialog-atlas.html#mod-005` | FR-2 |
| MOD-006 | Unsupported Numbers/Pages/PDF refusal | Per-format Excel-export instructions | `./program/sheaf/mocks/dialog-atlas.html#mod-006` | FR-2 |
| MOD-007 | Cancel active import | Confirm no partial app will remain | `./program/sheaf/mocks/dialog-atlas.html#mod-007` | FR-3 |
| MOD-008 | Import failure details | Named stage/sheet, cleanup fact, retry path | `./program/sheaf/mocks/dialog-atlas.html#mod-008` | FR-2–3 |
| MOD-009 | Delete record | Recoverable change-log deletion confirmation | `./program/sheaf/mocks/dialog-atlas.html#mod-009` | FR-12, FR-28 |
| MOD-010 | Restore deleted record | Show original record/time and validation before restore | `./program/sheaf/mocks/dialog-atlas.html#mod-010` | FR-12, FR-28 |
| MOD-011 | Repair broken reference | Original key, search related table, leave flagged | `./program/sheaf/mocks/dialog-atlas.html#mod-011` | FR-11–12 |
| MOD-012 | Discard chart draft | Leave, keep editing, or save draft locally | `./program/sheaf/mocks/dialog-atlas.html#mod-012` | FR-16 |
| MOD-013 | Chart saved / pin choice | Saved name and pin-to-home decision | `./program/sheaf/mocks/dialog-atlas.html#mod-013` | FR-16, FR-25 |
| MOD-014 | Schema impact confirmation | Exact affected counts; preserve and flag | `./program/sheaf/mocks/dialog-atlas.html#mod-014` | FR-15 |
| MOD-015 | Unsupported-formula rewrite | Original text/imported value/new-row empty behavior | `./program/sheaf/mocks/dialog-atlas.html#mod-015` | FR-14 |
| MOD-016 | Provider permission primer | Narrow app-folder scope, account, isolation, no sharing | `./program/sheaf/mocks/dialog-atlas.html#mod-016` | FR-21, FR-27 |
| MOD-017 | Provider authorization failed | Provider-named failure; local app remains usable | `./program/sheaf/mocks/dialog-atlas.html#mod-017` | FR-20, FR-26 |
| MOD-018 | Provider reconnect required | Expired token, last good backup, reconnect remedy | `./program/sheaf/mocks/dialog-atlas.html#mod-018` | FR-26 |
| MOD-019 | Provider quota full | Failed confirmed backup and provider remedy | `./program/sheaf/mocks/dialog-atlas.html#mod-019` | FR-26 |
| MOD-020 | First vault passphrase choice | Reuse local secret or create a separately named home secret | `./program/sheaf/mocks/dialog-atlas.html#mod-020` | FR-23–24 |
| MOD-021 | Vault recovery code issued | Named home and exact cross-device scope | `./program/sheaf/mocks/dialog-atlas.html#mod-021` | FR-23–24 |
| MOD-022 | Reveal local recovery code | Current local passphrase required and local scope repeated | `./program/sheaf/mocks/dialog-atlas.html#mod-022` | FR-23 |
| MOD-023 | Named vault secret prompt | One-time prompt for a second home | `./program/sheaf/mocks/dialog-atlas.html#mod-023` | FR-23–24 |
| MOD-024 | Bundle secret prompt | Prompt at open time with bundle-vault scope | `./program/sheaf/mocks/dialog-atlas.html#mod-024` | FR-24, FR-30 |
| MOD-025 | Save fresh bundle | Staleness, destination, manual-only facts | `./program/sheaf/mocks/dialog-atlas.html#mod-025` | FR-25–27 |
| MOD-026 | Disconnect durable home | What remains local; no implicit deletion | `./program/sheaf/mocks/dialog-atlas.html#mod-026` | FR-21, FR-25 |
| MOD-027 | Plaintext export confirmation | Exact format/scope and unencrypted acknowledgement | `./program/sheaf/mocks/dialog-atlas.html#mod-027` | FR-18, FR-27 |
| MOD-028 | Routine local removal | Zero device-only changes and exact restorable backup | `./program/sheaf/mocks/dialog-atlas.html#mod-028` | FR-33 |
| MOD-029 | Destructive local removal | Nonzero changes, backup/bundle/export remedies, loss acknowledgement | `./program/sheaf/mocks/dialog-atlas.html#mod-029` | FR-18, FR-26, FR-33 |
| MOD-030 | Delete everywhere | Name/count, retained marker, not-remote-wipe explanation | `./program/sheaf/mocks/dialog-atlas.html#mod-030` | FR-33 |
| MOD-031 | Deletion-marker rescue | Offline copy has changes; export/bundle before acknowledgement | `./program/sheaf/mocks/dialog-atlas.html#mod-031` | FR-33 |
| MOD-032 | Readable reset inventory | Per-app counts, backups, device-only changes, remedies | `./program/sheaf/mocks/dialog-atlas.html#mod-032` | FR-23, FR-26 |
| MOD-033 | Locked typed reset | Generic unknowns and exact confirmation phrase | `./program/sheaf/mocks/dialog-atlas.html#mod-033` | FR-22–23 |
| MOD-034 | Identity conflict | Competing row matches; explicit user choice only | `./program/sheaf/mocks/dialog-atlas.html#mod-034` | FR-31 |
| MOD-035 | Absent-row bulk action | Keep by default; review explicit deletes | `./program/sheaf/mocks/dialog-atlas.html#mod-035` | FR-31 |
| MOD-036 | Adoption exceeds storage budget | No payload transfer; remain listed-only | `./program/sheaf/mocks/dialog-atlas.html#mod-036` | FR-30, FR-34 |
| MOD-037 | Change-passphrase confirmation | Current secret, no data loss, re-wrap in progress | `./program/sheaf/mocks/dialog-atlas.html#mod-037` | FR-23 |

### Bottom-sheet and popover inventory

Phone uses bottom sheets; tablet/desktop may render the same content as an
anchored popover or side panel. Every item is shown in
`./program/sheaf/mocks/sheet-atlas.html`.

| ID | Sheet / popover | Contents and states | Mock source | Requirements |
|---|---|---|---|---|
| SHT-001 | Enum value picker | Options, search for long sets, current value, clear | `./program/sheaf/mocks/sheet-atlas.html#sht-001` | FR-12 |
| SHT-002 | Reference picker | Search related records, human label, create/open related | `./program/sheaf/mocks/sheet-atlas.html#sht-002` | FR-11–12 |
| SHT-003 | Table switcher | Tables, row counts, current table | `./program/sheaf/mocks/sheet-atlas.html#sht-003` | FR-11 |
| SHT-004 | Enum filter | Single/multi selection and clear | `./program/sheaf/mocks/sheet-atlas.html#sht-004` | FR-13 |
| SHT-005 | Date-range filter | Start/end/open-ended/invalid range | `./program/sheaf/mocks/sheet-atlas.html#sht-005` | FR-13 |
| SHT-006 | Number/currency filter | Minimum/maximum/open-ended/invalid | `./program/sheaf/mocks/sheet-atlas.html#sht-006` | FR-13 |
| SHT-007 | Boolean filter | Either/yes/no | `./program/sheaf/mocks/sheet-atlas.html#sht-007` | FR-13 |
| SHT-008 | Reference filter | Search/select related record, broken item | `./program/sheaf/mocks/sheet-atlas.html#sht-008` | FR-11, FR-13 |
| SHT-009 | Sort picker | Every column, ascending/descending | `./program/sheaf/mocks/sheet-atlas.html#sht-009` | FR-13 |
| SHT-010 | Record actions | Edit, duplicate, history, delete | `./program/sheaf/mocks/sheet-atlas.html#sht-010` | FR-12, FR-28 |
| SHT-011 | App-tile actions | Open, back up, export when local, remove when local | `./program/sheaf/mocks/sheet-atlas.html#sht-011` | FR-18–19, FR-26, FR-34 |
| SHT-012 | Chart-mark detail | Series/category/value, apply/clear filter | `./program/sheaf/mocks/sheet-atlas.html#sht-012` | FR-16 |
| SHT-013 | Inference evidence | Declared rule/formula/format/value-pattern detail | `./program/sheaf/mocks/sheet-atlas.html#sht-013` | FR-4–8 |
| SHT-014 | Field/table action menu | Rename, change type, relationship, formula, delete | `./program/sheaf/mocks/sheet-atlas.html#sht-014` | FR-14–15 |
| SHT-015 | Provider/account picker | Connected same-person accounts, add account, scope | `./program/sheaf/mocks/sheet-atlas.html#sht-015` | FR-21, FR-25 |
| SHT-016 | Snapshot options | Find, export sheet, inert items, return to live table | `./program/sheaf/mocks/sheet-atlas.html#sht-016` | FR-5, FR-9, FR-18 |
| SHT-017 | Chart/table accessibility view | Text summary and full/partial data table | `./program/sheaf/mocks/sheet-atlas.html#sht-017` | FR-16, FR-34 |
| SHT-018 | Mobile conflict source picker | Source/timestamp/value with no layout-dependent meaning | `./program/sheaf/mocks/sheet-atlas.html#sht-018` | FR-32 |

### Persistent state and notification inventory

All semantic states are rendered together in
`./program/sheaf/mocks/state-atlas.html`; route-level examples also appear in
the relevant full-screen mocks.

| ID | State | Required copy/behavior | Mock source | Requirements |
|---|---|---|---|---|
| STA-001 | Saved locally | Acknowledged only after durable local write | `./program/sheaf/mocks/state-atlas.html#sta-001` | FR-12, FR-26 |
| STA-002 | Backup queued offline | Neutral; retry on resume | `./program/sheaf/mocks/state-atlas.html#sta-002` | FR-20, FR-26, FR-29 |
| STA-003 | Backup in progress | Non-blocking; last-success time unchanged | `./program/sheaf/mocks/state-atlas.html#sta-003` | FR-26 |
| STA-004 | Backup confirmed | Advance time only after provider acknowledgement | `./program/sheaf/mocks/state-atlas.html#sta-004` | FR-26 |
| STA-005 | Token expired | Named failure + reconnect | `./program/sheaf/mocks/state-atlas.html#sta-005` | FR-26 |
| STA-006 | Quota full | Named failure + provider remedy | `./program/sheaf/mocks/state-atlas.html#sta-006` | FR-26 |
| STA-007 | Interrupted backup | Prior good copy readable; retry pending | `./program/sheaf/mocks/state-atlas.html#sta-007` | FR-26 |
| STA-008 | Scratch | Persistent badge + reminder + device-only count | `./program/sheaf/mocks/state-atlas.html#sta-008` | FR-25–26 |
| STA-009 | Bundle stale | Loudest state + save-fresh-bundle | `./program/sheaf/mocks/state-atlas.html#sta-009` | FR-25–26 |
| STA-010 | Pending conflict | Text flag + queue count; app still usable | `./program/sheaf/mocks/state-atlas.html#sta-010` | FR-32 |
| STA-011 | Broken reference | Named missing relation + original key | `./program/sheaf/mocks/state-atlas.html#sta-011` | FR-11 |
| STA-012 | Preserved inert content | Type, location, reason, snapshot link | `./program/sheaf/mocks/state-atlas.html#sta-012` | FR-9 |
| STA-013 | Unsupported formula | Imported value kept; new row empty/flagged | `./program/sheaf/mocks/state-atlas.html#sta-013` | FR-14 |
| STA-014 | Query partial | Exact omitted scope/count + clear remedy | `./program/sheaf/mocks/state-atlas.html#sta-014` | FR-13, FR-34 |
| STA-015 | Chart partial | Exact sample/scope + accessible summary | `./program/sheaf/mocks/state-atlas.html#sta-015` | FR-16, FR-34 |
| STA-016 | Approaching capacity | Named budget only | `./program/sheaf/mocks/state-atlas.html#sta-016` | FR-34 |
| STA-017 | Oversized-local | Data local, entry disabled, ownership actions retained | `./program/sheaf/mocks/state-atlas.html#sta-017` | FR-18–19, FR-34 |
| STA-018 | Listed-only | Data not local, truthful adoption actions only | `./program/sheaf/mocks/state-atlas.html#sta-018` | FR-19, FR-30, FR-34 |
| STA-019 | Import cancelled | No partial app remains | `./program/sheaf/mocks/state-atlas.html#sta-019` | FR-3 |
| STA-020 | Adoption refused by capacity | No payload downloaded; app remains remote | `./program/sheaf/mocks/state-atlas.html#sta-020` | FR-30, FR-34 |
| STA-021 | Deletion marker / zero changes | Local copy removed and reason announced | `./program/sheaf/mocks/state-atlas.html#sta-021` | FR-33 |
| STA-022 | Deletion marker / changes present | Rescue choices and explicit acknowledgement | `./program/sheaf/mocks/state-atlas.html#sta-022` | FR-33 |
| STA-023 | Baseline absent | Every difference asks; no automatic choice | `./program/sheaf/mocks/state-atlas.html#sta-023` | FR-28, FR-32 |
| STA-024 | Merge validation failed | Whole-record conflict with reason | `./program/sheaf/mocks/state-atlas.html#sta-024` | FR-12, FR-32 |
| STA-025 | Empty / first use | No fictional data; one truthful next action | `./program/sheaf/mocks/state-atlas.html#sta-025` | FR-19 |
| STA-026 | No search results | Active filters visible and individually clearable | `./program/sheaf/mocks/state-atlas.html#sta-026` | FR-13 |

### Native and provider-owned surfaces

These surfaces are not visually restyled or imitated. The mock contract covers
the Sheaf control that launches them, the explanation before launch, and the
return states.

| ID | External surface | Sheaf-owned launch contract | Return contract | Requirements |
|---|---|---|---|---|
| EXT-001 | Platform file picker | Device files and cloud locations including iCloud as source | Return selected/cancelled/unreadable | FR-1 |
| EXT-002 | Share / open-in target | File handed from another app | Return selected/cancelled | FR-1 |
| EXT-003 | Native date picker | Platform date entry | Return date/cancelled | FR-12 |
| EXT-004 | Platform keyboards | Numeric, telephone, email, URL | No product chrome over keyboard | FR-6, FR-12 |
| EXT-005 | Phone dialer | Tappable phone handoff | Sheaf remains unchanged on return | FR-12 |
| EXT-006 | Maps application | Tappable address handoff | Sheaf remains unchanged on return | FR-12 |
| EXT-007 | Browser/PWA install prompt | Browser-owned install confirmation | Sheaf education precedes; safety claim prohibited | FR-20 |
| EXT-008 | Provider OAuth authorization | Provider-owned account/consent | Return connected/cancelled/failed; no workbook plaintext | FR-21, FR-26–27 |
| EXT-009 | Platform save/share destination | Exports and bundle files | Return saved/cancelled/failed; plaintext warning already accepted for exports | FR-18, FR-25 |

### Requirement-to-surface closure

| Requirement | Complete visual sources |
|---|---|
| FR-1 | SCR-016–018, MOD-004, EXT-001–002 |
| FR-2 | SCR-021–022, MOD-005–006 |
| FR-3 | SCR-018–020, MOD-007–008 |
| FR-4 | SCR-023, SHT-013 |
| FR-5 | SCR-023, SCR-030–031 |
| FR-6 | SCR-023, SCR-028–029, CTL-030–039 |
| FR-7 | SCR-023, SCR-035, SHT-013–014 |
| FR-8 | SCR-023, SHT-013 |
| FR-9 | SCR-023, SCR-030–031, STA-012 |
| FR-10 | SCR-019, SCR-040–042 |
| FR-11 | SCR-025, SCR-027, SHT-002 |
| FR-12 | SCR-027–029, MOD-009–011, SHT-001–002, EXT-003–006 |
| FR-13 | SCR-025–026, SHT-004–009, STA-014/026 |
| FR-14 | SCR-023, SCR-029, SCR-035, MOD-015, STA-013 |
| FR-15 | SCR-035, MOD-014, SHT-014 |
| FR-16 | SCR-024, SCR-033–034, SHT-012/017, STA-015 |
| FR-17 | SCR-024, SCR-036 |
| FR-18 | SCR-049–050, MOD-027, EXT-009 |
| FR-19 | SCR-010–012, CTL-060–065 |
| FR-20 | SCR-001–003, SCR-013, STA-002, EXT-007 |
| FR-21 | SCR-014, SCR-038, MOD-016/026, SHT-015, EXT-008 |
| FR-22 | SCR-002–008, CTL-026–029/096–100 |
| FR-23 | SCR-004–009, SCR-006–007, MOD-021–023/032–033/037 |
| FR-24 | SCR-002, SCR-007, SCR-014/038/040, MOD-020–024 |
| FR-25 | SCR-010, SCR-024, SCR-038, MOD-001–002/025–026, STA-008–009 |
| FR-26 | SCR-010, SCR-024, SCR-039, MOD-017–019/025/028–029, STA-002–009 |
| FR-27 | SCR-038–041, CTL-099, MOD-016/027, EXT-008–009 |
| FR-28 | SCR-032, SCR-039, SCR-045–048, MOD-009–010 |
| FR-29 | SCR-039, SCR-043–048, STA-002/010 |
| FR-30 | SCR-010, SCR-014–015, SCR-040–042, MOD-024/036, STA-018/020 |
| FR-31 | SCR-043–047, MOD-034–035 |
| FR-32 | SCR-046–048, SHT-018, STA-010/023–024 |
| FR-33 | SCR-049/051–052, MOD-028–031, STA-021–022 |
| FR-34 | SCR-019, SCR-025, SCR-033–034, SCR-040–042, STA-014–018/020 |

Mock navigation is included for orientation. The later `prototype` phase is
still responsible for a fully linked
`./program/sheaf/mocks/index.html` walkthrough; this design revision does not
write ahead into that phase.

---

## Key Interaction Rules

### Shell and generated-app boundary

- The Sheaf mark remains small inside a generated app. Its branded header and
  primary navigation use the app's tokens, not the shell palette.
- Returning to the library is always labelled **All apps**; it is not a
  mysterious logo-only escape hatch.
- App theme changes affect app chrome and data visualization, not safety
  semantics or destructive confirmations.

### Backup language

- Show **last confirmed backup**, never last attempt.
- Pair the time with **N changes only on this device**. Zero is shown because
  it is a useful fact, not omitted as though unknown.
- **Back up now** sits beside the status wherever the status appears.
- Offline copy is neutral: *Saved on this device. Backup will retry when this
  device is online.*
- A bundle home uses the stronger phrase *Bundle out of date* immediately
  after a change and leads with **Save a fresh bundle**.

### Import and review

- Sizing is visually a distinct stage before parsing. The sheet checklist may
  show names and declared dimensions but never implies that cell content has
  already been read.
- The review screen is one route with anchored sections, not a dismissible
  wizard whose later steps can be accidentally skipped.
- Each statement has a visible evidence tag and an **Edit** action. A user's
  rejection is represented as a stored choice in the copy, not a transient
  close icon.
- Unsupported or inert content appears in the review count and links to its
  preserved sheet snapshot.

### Records and data entry

- Search and active filters stay visible while records scroll.
- Phone cards put the human label first and expose at most three supporting
  facts. Desktop tables may be dense but preserve the same labels and states.
- A broken reference prints **Missing related record** plus the original key
  in a details disclosure. It never becomes a blank cell.
- Computed fields are visibly read-only, show the expression in user terms,
  and announce recalculation without stealing focus.
- Save acknowledges only after the change is durable locally. Backup is a
  separate, non-blocking status update.

### Conflict resolution

- The default comparison order is **agreed value → this device → incoming**.
  On phone these stack; tablet/desktop place current copies side by side with
  the baseline above.
- Sources always include human label and timestamp: *This phone · edited
  today, 8:14 AM*; *Uploaded workbook · Sep 7, 7:52 AM*.
- One-sided automatic changes do not enter the pending queue. They appear in
  the adjacent **Applied automatically** log with the baseline and validation
  result available on expansion.
- Key/FK and delete/edit conflicts cannot expose a default chosen side.
- If field-wise choices form an invalid record, the action remains disabled
  and the whole-record rule is stated directly next to it.
- A baseline-absent conflict is labelled **No agreed starting value** and
  explains why Sheaf is asking rather than guessing.

### Capacity

- **Oversized-local:** *On this device · too large to open here.* Actions:
  desktop, export, back up, reduce scope, remove.
- **Listed-only:** *In Dropbox · not on this device.* Actions: larger device,
  free space and adopt. Never show export, backup, or remove-local.
- Query/chart omissions include a count or exact scope where known, e.g.
  *Showing 2,000 of 18,440 rows; export still includes all local rows.*

### Destructive actions

- Use verb-object labels: **Remove from this phone**, **Delete Fieldbook
  everywhere**, **Reset this device**.
- A routine local removal is described as reversible only when device-only
  changes are zero.
- Any device-only changes promote removal to destructive and surface backup,
  bundle, and export before the confirmation.
- Delete-everywhere explicitly says it is not a remote wipe and explains what
  happens when an offline device reconnects.
- Locked reset never names, counts, or hints at encrypted apps. Its inability
  to enumerate is stated as the encryption working as intended.

---

## User Flows

1. **First use and ten-second proof:** Protect this device → record the local
   recovery code → Library → Upload workbook → pre-flight → streamed import →
   single review → Create app → generated app home.
2. **Chart-first value:** Library → Upload workbook → review imported chart →
   generated app home → tap chart segment → filtered Records list → clear
   filter.
3. **One-handed field edit:** App home → table → sticky search/filter → record
   → typed edit → local validation → save locally → return immediately →
   backup status advances later on confirmed durable write.
4. **Scratch investment reminder:** Edit/save in a scratch app → non-blocking
   reminder → choose durable home or dismiss → persistent scratch badge remains
   → reminder returns later at an escalated interval.
5. **Make data durable:** App status → Durable home → choose provider or
   bundle → explain exact capability/privacy → unlock/create that vault → issue
   separately labelled vault recovery code → first encrypted backup → status
   shows confirmed time and zero device-only changes.
6. **Adopt on another device:** Unlock local store → connect same durable home
   → enter that home's vault secret → library discovers listed-only apps →
   pre-download sizing → choose app → download/adopt → open with no import and
   no review.
7. **Resolve divergence:** Conflict badge → Resolve conflicts → inspect
   baseline/local/incoming → choose per field or whole row → validate result →
   apply → inspect applied-automatically log → back up merged log.
8. **Invalid automatic merge:** Conflict queue → see whole source records and
   rule failure → choose one whole version or edit a valid record → resolve.
9. **Re-upload workbook:** App utilities → Re-upload newer workbook → establish
   row identity → review unmatched/absent rows → reuse conflict surface for
   contested values → apply valid result. No identity guess and no automatic
   deletion.
10. **Oversized app:** Library tile → capacity door → if data is local, export,
    back up, reduce scope, remove, or use desktop; if listed-only, free space
    and adopt or use a larger device.
11. **Safe removal:** App settings → Remove from this phone → calculate backup
    fact and device-only count → if nonzero, offer backup/bundle/export →
    re-calculate after successful backup → routine confirmation only when zero.
12. **Forgotten secret:** Unlock → use local recovery code → change local
    passphrase with no loss. If both are lost → three-stage generic reset →
    new local vault → optionally reconnect durable homes and recover only their
    last successful backups.

---

## Accessibility Contract

- DOM and visual order stay aligned at every layout class; the desktop table
  and tablet detail pane do not create a separate keyboard order.
- Every control has a visible label or an accessible name; placeholder text is
  never the sole label.
- Focus uses a 3px Leaf/Sprout outline with 2px separation and remains visible
  on dark themed chrome.
- Minimum hit area is 44×44px. Adjacent destructive and safe actions have at
  least 8px separation.
- Status icons are `aria-hidden`; complete state copy remains in text.
- Charts have a text summary and a data-table route. Selecting a mark announces
  the filter and updates the list heading.
- Import progress exposes stage, current sheet, and numeric progress to
  assistive technology without announcing every row.
- Conflict columns are labelled by source and timestamp before their values;
  choice controls repeat enough context to remain understandable out of visual
  layout.
- Dialogs and bottom sheets trap focus, restore it to the invoking control,
  close with Escape where cancellation is safe, and do not close on outside
  click during destructive confirmation.
- At 200% text size, bottom actions may wrap but never overlap content. No
  required content is clipped at 320px width.

---

## Content Patterns

- **Facts, then remedy:** *3 changes only on this device. Last backup yesterday
  at 4:12 PM.* → **Back up now**.
- **Named omission:** *Chart uses the newest 5,000 of 18,440 local rows on this
  phone.* → **Open full data** / **Use desktop**.
- **Preserved but inert:** *2 drawing objects were kept in the “Overview”
  snapshot. Sheaf cannot make them interactive.* → **View snapshot**.
- **Local success:** *Saved on this device.* Never claim *Synced* before the
  provider confirms.
- **No blame:** *This file contains macros, which Sheaf never runs.* Not *Bad
  file*.
- **Exact secret:** *Enter this device's unlock passphrase* or *Enter the
  Dropbox Fieldwork vault passphrase*. Never *Enter your passphrase*.
- **Exact location:** *Remove from this phone* and *Delete everywhere* are never
  shortened to two ambiguous trash icons.

---

## Mock Notes

- The HTML files are standalone visual contracts. The exhaustive set contains product screens plus control, dialog, sheet/popover, and state atlases. Tailwind's CDN is used only
  to accelerate mocks; it is not a production stack decision.
- Provider authorisation, file parsing, encryption, persistence, charts, and
  exports are represented but intentionally non-functional.
- Sample data is fictional. It demonstrates one generated app identity without
  constraining what identities imported workbooks may choose.
- Google Drive appears as a conditional provider option. Architecture must
  verify the required discovery/isolation behavior; if it fails, the card is
  removed rather than enabled with broader access.
- The design intentionally specifies no framework, storage engine, charting
  library, workbook parser, or cryptographic implementation.
