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

## Component Inventory

| Component | Description | States |
|---|---|---|
| Bound-sheets mark | Three offset sheets forming the Sheaf identity | light surface, dark surface, monochrome |
| Shell header | Wordmark, scope title, connectivity-neutral controls | default, search open, compact |
| Navigation rail | Shell/app destinations and current context | icon-only tablet, labelled desktop, selected, notification count |
| Bottom navigation | Phone navigation with primary middle action | default, selected, badge, safe-area padded |
| Primary button | One dominant action per region | default, hover, pressed, focus, busy, disabled |
| Secondary button | Reversible or supporting action | default, hover, pressed, focus, disabled |
| Danger button | Destructive action after facts/remedies | default, focus, busy, disabled |
| Icon button | Compact utility action with accessible name | default, hover, focus, disabled |
| Text input | Typed text entry | default, focus, populated, invalid, disabled, read-only |
| Native value input | Date, number, currency, phone, email, URL | default, focus, invalid, disabled |
| Picker field | Enum/reference opener, rendered as a bottom sheet on phone | empty, populated, open, invalid, broken reference |
| Search field | Sticky table/library search | idle, typing, populated, no results |
| Filter chip | Type-aware filter or active constraint | available, selected, removable, disabled |
| Segmented control | Small mutually exclusive choice | default, selected, disabled |
| App tile | Branded doorway to one generated app | present, scratch, stale, conflict, oversized-local, listed-only |
| App identity plate | Logo, name, table context, app theme | compact, full, dark/light theme |
| Status badge | Text-first compact state | scratch, stale, backed up, offline, conflict, inert, broken |
| Backup ledger | Last confirmed backup + device-only count + remedy | current, pending, offline, failed, bundle stale, scratch |
| Capacity card | Budget fact and actions appropriate to data locality | oversized-local, listed-only, approaching budget |
| Workbook dropzone | File picker / share-target landing | empty, drag over, chosen, unsupported, macro refused |
| Pre-flight sheet row | Sheet inclusion and size estimate | selected, excluded, required, over budget |
| Progress ledger | Stage, sheet name, determinate/indeterminate work | scanning, importing, cancelling, failed, complete |
| Inference card | One plain-language review decision with evidence | accepted, edited, warning, expanded |
| Evidence tag | Why an inference was made | declared, formula, formatting, value pattern, guess |
| Snapshot link | Route to preserved read-only sheet content | normal, inert-content count, unavailable |
| Metric card | Calculated app value | default, recalculating, stale/omitted, error |
| Chart panel | Touch-native chart with source and scope | default, filtered, partial, empty, over budget |
| Record card | Phone representation of a row | default, selected, conflict, broken reference, deleted/restorable |
| Dense data table | Desktop table with sticky header and sort | default, sorted, filtered, selected row, omitted rows |
| Relationship strip | Parent/child navigation and counts | normal, empty, broken reference |
| Formula value | Computed read-only value with expression access | current, recalculating, unsupported, empty/flagged |
| Validation summary | User-language record and field errors | inline, record-level, merge-level |
| Impact preview | Schema change consequences before commit | none, affected values, blocking issue |
| Chart-type card | Visual chart selector | available, selected, unavailable for data |
| Durable-home card | Provider or bundle option with capability facts | available, connected, reconnect, conditional, unavailable |
| Recovery-code card | One code labelled by exact recovery scope | hidden, revealed, copied, confirmed written down |
| Conflict queue item | Conflict identity, source, cause, decision state | field, key/FK, delete/edit, baseline-absent, resolved |
| Value comparison | Baseline/local/incoming values with provenance | unchanged, one-side change, contested, chosen |
| Record conflict panel | Whole-record resolution when merged result is invalid | pending, editing, valid, resolved |
| Applied-log row | Auditable automatic merge | collapsed, expanded |
| Bottom sheet / dialog | Focus-contained transient decision surface | open, validation error, busy, destructive |
| Toast / inline notice | Confirmation that does not hide persistent status | saved locally, backup confirmed, offline queued, error |
| Empty state | Next action with no fictional data | first library, no records, no chart, no conflicts |

---

## Screen Inventory

| Screen | Mock file | Purpose and required states |
|---|---|---|
| Protect this device | `./program/sheaf/mocks/setup.html` | Create the offline local unlock, issue the local recovery code, and distinguish the later per-home vault code (FR-22–24) |
| Unlock | `./program/sheaf/mocks/unlock.html` | Cold launch with no decrypted app inventory, local recovery route, escalating delay copy, and explicit reset route (FR-20, FR-22–23) |
| Library | `./program/sheaf/mocks/library.html` | Shell launch destination, upload action, independent app themes, backup facts, and present/scratch/listed-only/oversized-local tiles (FR-19, FR-25–26, FR-30, FR-34) |
| Workbook pre-flight | `./program/sheaf/mocks/import.html` | Content-detected format, sheet sizing/selection, streaming progress, refusal language, and desktop handoff (FR-1–3, FR-10) |
| Review what Sheaf found | `./program/sheaf/mocks/review.html` | The single plain-language import review with editable tables, types, relationships, formulas, sheet use, and preserved content (FR-4–9, FR-14) |
| Generated app home | `./program/sheaf/mocks/app-home.html` | A distinctly themed app with metrics, imported/pinned chart, table routes, app status, and scratch reminder pattern (FR-11, FR-14, FR-16–17, FR-25–26) |
| Records | `./program/sheaf/mocks/records.html` | Sticky search, type-aware filters, phone cards, tablet split view, desktop dense table, relationships, and named omissions (FR-11, FR-13, FR-34) |
| Record detail/edit | `./program/sheaf/mocks/record-edit.html` | Typed controls, reference picker, dial/maps affordances, live formula, column/record validation, delete recovery, thumb-zone save (FR-11–12, FR-14) |
| Chart builder | `./program/sheaf/mocks/chart-builder.html` | Chart type, relational fields, touch preview/filter behavior, save and pin, chart-budget degradation (FR-16, FR-34) |
| App structure editor | `./program/sheaf/mocks/schema.html` | Permanent schema editing, formula/relationship access, user-language rules, and counted impact preview (FR-12, FR-14–15) |
| Durable home & backup | `./program/sheaf/mocks/durable-home.html` | Provider/bundle choice, exact privacy boundary, conditional Drive card, iCloud explanation, confirmed backup age, device-only count, and one-tap remedy (FR-21, FR-23–27, FR-30) |
| Resolve conflicts | `./program/sheaf/mocks/conflicts.html` | Required three-way values, provenance, baseline-absent explanation, whole-record invalid merge, pending queue, and applied log (FR-28–32) |
| Capacity door | `./program/sheaf/mocks/capacity.html` | Explicitly different oversized-local and listed-only states with only truthful actions (FR-18–19, FR-30, FR-34) |
| Export or remove | `./program/sheaf/mocks/export-remove.html` | Plaintext export warning, device-only loss facts, remedies, remove-local vs delete-everywhere, and offline-copy language (FR-18, FR-26, FR-33) |
| Reset without a readable store | `./program/sheaf/mocks/reset.html` | Locked generic destructive path that exposes no plaintext inventory and explains exactly what cannot be known (FR-22–23) |

All paths above are relative to the workspace root. Mock navigation is provided
for orientation, but the separate `prototype` phase remains responsible for a
fully linked `./program/sheaf/mocks/index.html` walkthrough.

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

- The HTML files are standalone visual contracts. Tailwind's CDN is used only
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
