# Idea — Sheaf

> *Your spreadsheet, as an app on your phone.*

## One-Sentence Summary

Sheaf is a serverless app generator that turns a spreadsheet workbook into an
installable, offline, phone-native relational application for anyone who
maintains a spreadsheet and wishes it were just an app on their phone.

A **sheaf** is a bundle of sheets bound together — which is both what a
workbook is and what the app library is. The name carries the product; the
tagline carries the search.

The framing sentence, for anyone who needs the shape in three seconds:

> **It's Microsoft Access, rebuilt for a phone — with a live formula engine and
> end-to-end encrypted sync, and no server of our own.**

---

## Problem

An enormous number of people run something real out of a spreadsheet. Client
lists, invoices, inventory, job schedules, rosters, hours, expenses,
livestock, rentals, volunteers, inspections. The workbook is not a document to
them — it is their **system of record**, and it usually has years of accreted
structure in it: a header row, filled-down formulas, a totals row, a second
sheet that a `VLOOKUP` reaches into.

On a desktop this is tolerable. On a phone it is miserable, and the phone is
where these people actually are — in a truck, on a job site, at a counter, in
a customer's kitchen. The failures are the same every time:

- **Pinch, zoom, and horizontal scroll** to find one value in a wide sheet.
- **No validation.** A fat-fingered cell silently corrupts the record, and a
  formula three sheets away quietly changes with it.
- **No relationships.** The customer is on one sheet and their orders are on
  another, and the only join is the user's own memory.
- **The wrong keyboard.** Typing a phone number, a date, or a currency amount
  on a general-purpose grid is a small act of hostility.
- **No decent chart.** Most of these users have never gotten a chart they
  actually liked out of their own data, and they want one on their phone.

Every existing answer asks for something they won't give:

- **Microsoft Access** is the right *model* and effectively dead on mobile.
- **Airtable, Notion, and friends** demand migration, an account, a
  subscription, connectivity, and their data on someone else's servers.
- **Mobile Excel and Sheets** are the same grid on a smaller screen. They
  solve viewing, not using.

The gap is specific: **nobody turns the spreadsheet they already have into the
app they actually need, without taking their data away from them.**

---

## Vision

You upload a workbook and you get an app. Not a viewer, not a grid on a
smaller screen — an application, with typed tables, relationships, forms with
the right input for each column, search and filters, charts, and its own
identity.

The product has two layers. **The shell** is your library: every workbook
you've ever uploaded, as a tile — name, row count, theme, last opened. Tap one
to enter it, upload a new one, and that's the whole home screen. **The
generated apps** are self-contained and independently themed, each with its
own data store and its own look. Ten spreadsheets, ten apps, one install. The
invoicing workbook looks nothing like the inventory one, and that difference is
the moment a person stops seeing "a generic tool" and starts seeing "*my*
app."

Getting there is an act of inference, and the inference is the product. We
find the real header row and throw away the junk above it. We detect what each
column actually is — date, currency, phone, email, enum, reference. We find
the relationships between sheets, and we treat the user's own `VLOOKUP` and
`XLOOKUP` formulas as the strongest evidence there is, because a lookup is not
a guess about a foreign key, it is the user having already declared one in
their own hand. **Formulas persist**, translated out of fragile cell addresses
into durable column expressions: a filled-down formula becomes a live computed
column, a `SUM` at the foot of a column becomes a table metric, and both
recalculate the instant a record changes. Then we show all of it back in plain
language — *"Status looks like a dropdown with four options. Correct?"* — once,
at the start. And because rigidity is what kills tools like this, **the schema
stays editable forever**, not just during onboarding.

There is no server of ours, and there never will be — nothing we run, nothing
we pay for, nothing that can go down or be sold out from under a user. Storage
belongs to the user and lives in their account, not ours. The site is a static
deploy, and the store on the device is always authoritative — the app reads
and writes to it, online or off, and never waits on a network to start. The
product is **local-first and cloud-durable**, and the distinction matters:
requiring the cloud to *run* would put a fragile sign-in on the launch path of
the very platform we are trying to protect, while requiring it only to
*persist* costs nothing at runtime and makes durability **achievable and
observable** — a different and more honest claim than solving it, because a
home that has been configured is not the same as a backup that is current.

Because local storage on a phone is not a durable guarantee. It can be
reclaimed under storage pressure, after long disuse for a site the user never
installed, or the moment someone deletes the app — and the precise rules
differ by platform and change between releases, so the product cannot be built
on them. So **every app a user actually invests in must be given a durable
home**
before they are allowed to build on it. That home is a folder in their own
Google Drive, Dropbox, or OneDrive, or an encrypted bundle file they save
wherever they like. The requirement is that you say where this lives
permanently — not that you hold a cloud account. An app without one still
works; it is simply marked *scratch*, and says so, which is exactly what the
ten-second demo should be.

The honest promise, then, is not that data never leaves the device — it is
that **nothing written to a durable home is readable by us or by the storage
provider.** Naming the adversary is both the stronger claim and the truthful
one. Everything written to a durable home is end-to-end encrypted under a key
derived from the user's own passphrase, which is what lets a second device
sign in, pull the store, and decrypt it with nothing ever transferred between
the devices themselves. No pairing ceremony, no key exchange, no
infrastructure. The one deliberate exception is **export**: a file the user
asks for as XLSX, CSV, PNG, or PDF is written in the clear, because its entire
purpose is to be opened by something else — and the product says so, since an
exported workbook sitting in a downloads folder carries none of the guarantee.
Apple offers no third-party web API for iCloud Drive, so iCloud remains an
upload source but never a durable home — a limitation the product states
plainly rather than letting users assume otherwise. What falls out is
multi-device sync, real backup, and survival of a lost phone, with nothing to
run, nothing to pay for, and no third party who can read a single row.

And because the durable home holds the apps rather than merely backing them
up, a new device is never a fresh start. Install Sheaf on a tablet, point it
at the same home, enter the passphrase, and it finds what is already there and
offers it — schema, theme, saved charts, and data intact, with no workbook to
re-parse and no review screen to answer a second time. That is **adoption
rather than import**, and it is why a storage provider that cannot let a
second device enumerate what the first one wrote is not a durable home at all,
whatever else it offers.

Reconciling divergent copies is the engine that makes all of that possible.
Writes made offline queue locally and flush when they can, so two devices can
always diverge; a durable home does not prevent that, it only makes the
divergence recoverable. And it is the same engine that lets a user re-upload a
newer version of a workbook and have it merge into the app they have already
been using. Two devices that edited offline and a freshly re-uploaded file are
the same problem wearing different clothes: two versions of one dataset that
must be resolved field by field. One engine, both features. Changes are
recorded as an append-only log and compacted periodically — which is what
keeps a single save from rewriting an entire workbook, and is exactly the
shape reconciliation wants anyway. That engine is not a bonus; it is
structural.

---

## Target User

**Primary — anyone who uses a spreadsheet and wishes it could just be an app
on their phone.** Deliberately broad; the workbook is the qualifier, not the
industry. In practice they share a profile:

- The workbook is their **system of record**, not a scratch file.
- They are **not a developer** and will not write a schema, a query, or a
  formula in a language they have to learn.
- Their workbook **already has structure** — headers, filled-down formulas,
  cross-sheet lookups, a totals row — that they built themselves over time.
- They **work away from a desk**, at least some of the time, and often without
  reliable connectivity.
- They are **unwilling or unable to migrate** to a subscription platform, for
  reasons of cost, privacy, IT policy, or plain preference.

**Secondary — the chart-first user.** Someone handed a workbook who wants one
good chart on their phone in ten seconds, and may never create a record at
all. They are the shortest path to the product's value and the reason charts
are first-class rather than a dashboard afterthought.

---

## Key Features (high-level)

1. **Upload from anywhere** — phone, tablet, desktop, iCloud, Drive, email
   attachment. Multi-sheet workbooks in `.xlsx`, `.xlsb`, `.xls`, and `.ods`
   are read with all of the structure they declare; `.csv` and `.tsv` declare
   none, so they import value-only and can be added to an existing app, which
   is how a folder of exports still becomes relational. Format is determined
   by content, never by file extension. Across every format one contract
   holds: **supported structures become interactive, and unsupported content
   is preserved and visibly identified** — never silently dropped, and never
   silently inert.
2. **Structural inference** — real header row located, junk rows discarded,
   several tables on one sheet detected and split, and any table the workbook
   already declares taken as fact rather than guessed at.
3. **Sheet classification** — lookup lists become enum sources, summary tabs
   become dashboard metrics, and pivot tables and chart sheets are rebuilt as
   real charts, so an app opens with the user's own charts already on it.
   Every sheet is additionally retained as a read-only snapshot, so no sheet
   is ever silently lost.
4. **Type inference** — date, currency, number, phone, email, URL, address,
   boolean, enum, free text, reference — read from the workbook's own number
   formats and validation rules wherever they exist, inferred from values only
   where they don't.
5. **Relationship detection** — cross-sheet foreign keys, with the user's own
   lookup formulas as the primary signal and key-column matching as the
   secondary one.
6. **Plain-language review** — one onboarding confirmation screen, in the
   user's words, not the schema's.
7. **Permanently editable schema** — every inference is revisable at any time,
   from inside the app, forever.
8. **Live formula engine** — computed columns, table metrics, and standalone
   dashboard values, translated off cell addresses, recalculating on edit and
   editable by the user. Clock-volatile functions (`TODAY`, `NOW`) stay live
   and are never stored, so they can never conflict; nondeterministic ones
   (`RAND` and family) are frozen at import, because a value that differs per
   device would break reconciliation. A formula using an unsupported function
   keeps its imported value, shows its original text for rewriting, and leaves
   newly created rows **empty and flagged rather than silently zero**.
9. **Relational tables with navigable relationships** — tap a customer, see
   their orders.
10. **Full CRUD with mobile-native input** — right keyboard per type, native
    date picker, bottom-sheet pickers, phone numbers dial, addresses open Maps,
    validation on every write.
11. **Query surface** — sticky search, horizontal filter chips, sort.
12. **First-class charts** — bar, line, pie, scatter, stacked; cross-sheet
    charts over detected relationships; saved and pinned to an app's home;
    touch-native, where tapping a bar filters the list beneath it.
13. **Per-app identity** — built-in themes plus per-app customization: color,
    accent, density, light/dark, logo.
14. **Installable, offline-first PWA** — fully usable with no network,
    launching straight from the local store rather than waiting on one.
    Home-screen install is encouraged for the experience, not demanded for
    safety, because durability is the durable home's job.
15. **A durable home for every app** — chosen before a user can invest real
    data: a folder in their own Google Drive, Dropbox, or OneDrive, or an
    encrypted bundle file they save themselves. Apps without one remain usable
    but are marked *scratch* and say plainly that they are not backed up.
    Choosing a home is not proof of a current one, so every app surfaces **when
    it last backed up successfully and how many changes exist only on this
    device**, with a one-tap way to back up now — because observability
    without a remedy is only anxiety. A manually saved bundle goes stale the
    moment a record changes, and is the loudest about it.
16. **End-to-end encrypted sync and backup** — everything written to a durable
    home is encrypted under a passphrase-derived key, so a second device needs
    only the passphrase and access to that home. No server of ours, no readable
    copy in anyone's cloud, no pairing ceremony. Deliberate exports are the one
    exception, and are plaintext by design.
17. **Merge and reconciliation engine** — an append-only change log, compacted
    periodically, resolving divergent copies field by field; powers offline
    write queues, multi-device sync, and re-uploading a newer version of an
    already-imported workbook.
18. **Graceful behavior at scale** — capacity is five separate budgets, not
    one: **importing**, **storing**, **querying**, **charting**, and
    **syncing**. Import is the only one desktop routing can solve, through a
    pre-flight sizing pass before parsing begins, sheet-by-sheet selection, a
    streamed import that never holds a whole workbook in memory, and a handoff
    to a desktop browser when a phone genuinely cannot parse — after which the
    durable home syncs the finished app back down. The other four remain the
    phone's problem no matter where the import ran, and charting is the
    hardest of them, since an aggregate is a full scan that a filter change can
    re-trigger. Each budget is stated separately, adapts to the device, and
    degrades visibly. Nothing is ever silently truncated; anything omitted is
    named.
19. **Export** — XLSX, CSV, chart PNG, and PDF reports, at any time.
20. **The shell** — a library of every generated app, each a tile with name,
    row count, theme, and last-opened.
21. **App discovery and adoption** — a device pointed at an existing durable
    home finds the apps already in it and offers them, continuously rather
    than only at install, so an app created on a desktop on Tuesday turns up
    on the phone. Adoption is not import: nothing is re-parsed, nothing is
    re-inferred, and the review screen never runs twice. Apps are adopted
    selectively and lazily, because a new phone rarely wants all of them at
    once. A durable home that is a saved bundle file has nothing to enumerate,
    so its apps are opened by hand — which the product says plainly at the
    moment a home is chosen.

---

## Non-Goals

These are things the product deliberately **is not**. Nothing here is a
deferred feature; the vision above is specified complete.

- **Not a spreadsheet editor.** No A1 addressing surface, no cell-grid-first
  editing model, no arbitrary cell references as the primary interaction.
- **Never runs macros.** A workbook containing VBA or macro content is
  **refused at import** — not partially parsed, not stripped and continued. The
  user is told plainly that macros are unsupported and offered the remedy of
  re-uploading a macro-free copy.
- **Not a multi-tenant SaaS.** No accounts, no server-side identity, no
  administrative backend, no subscription infrastructure.
- **Not network-dependent.** Connectivity is never required to launch, read,
  write, or search. The cloud is where data is kept durable, never where it is
  served from, and a signed-out or offline device is a fully working device.
- **Not a peer-to-peer system.** No direct device-to-device connections, no
  local-network discovery, no signalling, no relay. A relay that actually
  worked would require credentials this project cannot publish, and the durable
  home already serves every case peer sync was imagined for. Two devices reach
  each other only by way of a durable home, and nothing is ever transferred
  between them directly.
- **Not a sharing product.** There is no sharing at all: no shared folders, no
  invitations, no links, no recipients, no permissions, no revocation. An app
  belongs to one storage account and is reachable only from devices signed into
  that account. Getting data to another person means exporting a file and
  sending it, after which it is their file and no longer part of this app.
- **Not a multi-account system.** One account never sees another account's
  apps, under any circumstance. Discovery is scoped to the signed-in account
  and to nothing else — a boundary the product enforces, not a default it
  permits anyone to change.
- **Not a collaborative document.** No co-editing, no presence, no comment
  threads, no live session. Multiple devices means one person's devices.
- **Not linked to the original file.** Import is deliberate and explicit. The
  product never watches, re-reads, or writes back to the source file on disk or
  in cloud storage. Bringing in a newer version is always a user-initiated
  merge.
- **Not a universal file reader.** Apple Numbers, Pages, and PDF are refused
  with specific instructions for producing an Excel export instead, rather than
  half-parsed by an immature reader into data the user cannot trust.
- **Not a BI or data-warehouse tool.** No SQL surface, no joins the user has to
  author, no modeling layer.
- **No telemetry on user data.** Nothing about the contents of a workbook is
  measured, transmitted, or retained anywhere off-device.

---

## Open Questions

**None remain.** Every question raised during this phase was put to the builder
and answered before the phase closed. The answers are recorded below.

---

## Decisions Settled During the Idea Phase

Recorded here so later phases don't relitigate them.

- **Local-first, cloud-durable — not cloud-required.** The local store is
  authoritative for every read and write. A durable home is mandatory before a
  user invests real data, and is satisfied either by a cloud folder or by an
  encrypted bundle file the user saves themselves, so the requirement is a
  decision rather than an account.
- **Durability is achievable and observable, never solved.** A configured
  durable home is not a current backup. Tokens expire, quotas fill, offline
  edits queue, and a manually saved bundle is stale the instant a record
  changes. Every app therefore surfaces its last successful backup and its
  count of device-only changes, and offers an immediate way to act on it,
  because observability without a remedy is only anxiety.
- **Encryption is mandatory for everything written to a durable home, and
  deliberately absent from exports.** Unreadability by us and by the storage
  provider is the product's core claim, and an unencrypted blob sitting in
  someone's Drive would forfeit it outright. An export is the opposite case: a
  file the user asked for precisely so something else can open it, which
  encryption would defeat. The distinction is stated to users rather than
  assumed, since an exported workbook in a downloads folder carries none of the
  guarantee.
- **There is no sharing, and account isolation is a boundary rather than a
  default.** One storage account's apps are never visible to another, under any
  circumstance. Cutting sharing removed the only reason this product would have
  needed a trust model, a permission model, or a revocation story — and it
  removed a provider capability check that narrow application-folder scopes
  might well have failed, since an application folder is per-account by
  construction and cannot be handed to a second person. Getting data to another
  person means exporting a file, which is then theirs.
- **Passphrase-derived keys in two layers, no public-key infrastructure and no
  pairing.** The passphrase derives a **vault key**, and the vault holds the
  encrypted index of apps together with each app's own key, wrapped. A device
  holding nothing but a passphrase can therefore discover what exists, which a
  flat per-app model could not do, since a fresh device would have no key with
  which to read the index. Per-app keys are retained for blast-radius
  containment rather than for sharing: one compromised app key exposes one app,
  not the library. Because the durable home carries the encrypted store, a
  second device needs only the passphrase, and nothing is transferred device to
  device. A written recovery code remains available as an alternative to the
  passphrase.
- **A provider must pass two independent tests, and only two.** The first is
  **discovery**: can a second device, authorised as the *same* account,
  enumerate what the first device wrote — under a permission scope narrow
  enough to avoid a verification regime, and without hiding the user's own
  files from them. The second is **isolation**: is it structurally impossible
  for one account to enumerate another's. There is deliberately no third test,
  because there is no sharing; whether a provider could expose a folder to a
  second person is a question this product never asks. Dropbox and OneDrive
  application folders pass both, and pass isolation by construction. Google
  Drive is expected to pass discovery under per-file scope but is
  **provisional until verified during the architecture phase**, and is dropped
  outright if it cannot, rather than kept by widening scope or by burying a
  user's data where they can't see it. iCloud Drive is already excluded, for
  the reasons given in the Vision. A saved bundle file and a picked desktop
  folder are exempt from discovery, since neither claims to be discoverable —
  but never from isolation.
- **No secrets, no API keys, no paid infrastructure.** The site is a public
  static deploy from a public repository. Provider integration uses public
  OAuth client identifiers with PKCE and app-folder-scoped permissions, held in
  build-time configuration that a fork can supply for itself. The OAuth client
  is published to production status from the outset, because refresh tokens
  issued by an app still in testing status expire in days.
- **Storage format is an append-only change log with periodic compaction** —
  so a save writes a delta rather than rewriting a workbook, and so
  reconciliation has the history it needs.
- **The import contract: supported structures become interactive, unsupported
  content is preserved and visibly identified.** One rule for everything read
  out of a workbook — formulas, formatting, charts, layouts — rather than a
  carve-out invented per feature. Nothing is silently dropped and nothing is
  silently inert. Preserving content and reproducing its behaviour are separate
  guarantees, and the product never implies the first is the second.
- **Formula fidelity policy** — as recorded in Key Features 8, and an instance
  of the import contract above rather than a rule of its own.
- **Input formats form a fidelity ladder, not a list.** There is one pipeline;
  the format decides how much of it is reading rather than guessing, because a
  workbook's declared tables, validation rules, and number formats turn
  inference into fact. Spreadsheet formats are read with all of the structure
  they declare, delimited text declares none and imports value-only, and Apple
  Numbers is refused with instructions to export to Excel first rather than
  half-parsed by an immature reader. Format is decided by content, since macro
  files get renamed and legacy systems ship HTML tables under an `.xls`
  extension.
- **No sheet is ever silently discarded.** Sheets are classified rather than
  filtered — lookup lists into enum sources, summary tabs into dashboard
  metrics, pivot tables and chart sheets into real charts — and every sheet is
  additionally kept as a read-only snapshot. Aggressive classification is only
  safe because nothing it gets wrong is unrecoverable.
- **Several tables on one sheet are detected and split.** A declared table
  wins outright over any inference. Candidate regions with matching headers are
  proposed as one table rather than two, so a spacer row doesn't fracture real
  data, and the review screen confirms the split before it stands.
- **Import scale is a routing decision; operating scale is not.** Sizing
  happens before parsing, large workbooks offer sheet-by-sheet selection,
  import is streamed rather than held in memory, and a workbook too large for a
  phone is imported on a desktop and synced down through its durable home. That
  solves importing and nothing else. **Storing, querying, charting, and syncing
  remain the phone's problem no matter where the import ran**, and each carries
  its own stated limit — charting most of all, since an aggregate is a full
  scan that a filter change can re-trigger. Thresholds adapt to the device
  rather than being fixed, degrade visibly rather than silently, and anything
  omitted is named.
- **Product name** — *Sheaf*, with *"Your spreadsheet, as an app on your
  phone"* carrying the descriptive and search burden.
