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
> end-to-end encrypted sync, and no server anywhere.**

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

There is no server, and there never will be. The site is a static deploy, and
the store on the device is always authoritative — the app reads and writes to
it, online or off, and never waits on a network to start. The product is
**local-first and cloud-durable**, and the distinction matters: requiring the
cloud to *run* would put a fragile sign-in on the launch path of the very
platform we are trying to protect, while requiring it to *persist* costs
nothing at runtime and solves durability outright.

Because local storage on a phone is not durable. iOS reclaims a web app's
storage after a stretch of disuse, and no amount of care on our side prevents
it. So **every app a user actually invests in must be given a durable home**
before they are allowed to build on it. That home is a folder in their own
Google Drive, Dropbox, or OneDrive, or an encrypted bundle file they save
wherever they like. The requirement is that you say where this lives
permanently — not that you hold a cloud account. An app without one still
works; it is simply marked *scratch*, and says so, which is exactly what the
ten-second demo should be.

The honest promise, then, is not that data never leaves the device — it is
that **the data is never readable by anyone but you.** Everything written to a
durable home is end-to-end encrypted under a key derived from the user's own
passphrase, which is what lets a second device sign in, pull the store, and
decrypt it with nothing ever transferred between the devices themselves. No
pairing ceremony, no key exchange, no infrastructure. Apple offers no
third-party web API for iCloud Drive, so iCloud remains an upload source but
never a durable home — a limitation the product states plainly rather than
letting users assume otherwise. What falls out is multi-device sync, real
backup, survival of a lost phone, and the ability to hand an app to a
colleague — with nothing to run, nothing to pay for, and no third party who
can read a single row.

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

**Secondary — the person they hand it to.** A partner, a crew member, a
bookkeeper, a spouse. Receives a shared app, uses it, edits it, syncs back.
Never sees a spreadsheet and never needs to.

**Secondary — the chart-first user.** Someone handed a workbook who wants one
good chart on their phone in ten seconds, and may never create a record at
all. They are the shortest path to the product's value and the reason charts
are first-class rather than a dashboard afterthought.

---

## Key Features (high-level)

1. **Upload from anywhere** — phone, tablet, desktop, iCloud, Drive, email
   attachment. Multi-sheet workbooks at full fidelity in `.xlsx`, `.xlsb`,
   `.xls`, and `.ods`; `.csv` and `.tsv` as value-only imports that can be
   added to an existing app so a folder of exports still becomes relational.
   Format is determined by content, never by file extension.
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
16. **End-to-end encrypted sync, backup, and sharing** — everything leaving
    the device is encrypted under a passphrase-derived key, so a second device
    needs only the passphrase and access to the durable home. No server, no
    readable copy anywhere, no pairing ceremony.
17. **Merge and reconciliation engine** — an append-only change log, compacted
    periodically, resolving divergent copies field by field; powers offline
    write queues, multi-device sync, and re-uploading a newer version of an
    already-imported workbook.
18. **Graceful behavior at scale** — a pre-flight sizing pass before any
    parsing begins, sheet-by-sheet selection for large workbooks, a streamed
    import that never holds a whole workbook in memory, and routing to a
    desktop browser when a phone genuinely cannot do the import — after which
    the durable home syncs the finished app back down. Nothing is ever
    silently truncated; anything omitted is named.
19. **Export** — XLSX, CSV, chart PNG, and PDF reports, at any time.
20. **The shell** — a library of every generated app, each a tile with name,
    row count, theme, and last-opened.

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
- **Not a hosted collaborative document.** Sharing happens by handing someone
  access to an encrypted store — a shared storage folder or a bundle file plus
  a key — not by joining a live hosted session. No presence cursors, no comment
  threads, no server-mediated co-editing.
- **Not a permissions system.** Because there is no identity infrastructure,
  everyone holding an app's key holds the same access. There are no read-only
  shares, and removing someone means rotating the key for everyone, which stops
  their future access but cannot reach into their device and delete what they
  already hold. The product says this in those words rather than implying a
  revoke button does more than it does.
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
- **Encryption is mandatory wherever data leaves the device.** An
  unreadable-by-anyone-but-you guarantee is the product's core claim, and an
  unencrypted blob in someone's Drive would forfeit it outright.
- **Passphrase-derived symmetric keys, no public-key infrastructure and no
  pairing.** Because the durable home carries the encrypted store, a second
  device needs only the passphrase — nothing is transferred device to device. A
  written recovery code remains available as an alternative to the passphrase.
  Sharing is delegated to the storage provider's own folder sharing rather than
  to a trust model the product would have to build and maintain.
- **Durable home options, in order:** Google Drive, Dropbox, OneDrive, a saved
  encrypted bundle file, and a picked local folder on desktop. iCloud Drive is
  excluded, for the reasons given in the Vision.
- **No secrets, no API keys, no paid infrastructure.** The site is a public
  static deploy from a public repository. Provider integration uses public
  OAuth client identifiers with PKCE and app-folder-scoped permissions, held in
  build-time configuration that a fork can supply for itself. The OAuth client
  is published to production status from the outset, because refresh tokens
  issued by an app still in testing status expire in days.
- **Peer-to-peer sync is optional and best-effort, never load-bearing.** No
  feature depends on it, because a guaranteed relay would require credentials
  the project cannot publish. The durable home is always the reliable path.
- **Storage format is an append-only change log with periodic compaction** —
  so a save writes a delta rather than rewriting a workbook, and so
  reconciliation has the history it needs.
- **Formula fidelity policy** — as recorded in Key Features 8.
- **Input formats form a fidelity ladder, not a list.** There is one pipeline;
  the format decides how much of it is reading rather than guessing, because a
  workbook's declared tables, validation rules, and number formats turn
  inference into fact. Spreadsheet formats import at full fidelity, delimited
  text imports value-only, and Apple Numbers is refused with instructions to
  export to Excel first rather than half-parsed by an immature reader. Format
  is decided by content, since macro files get renamed and legacy systems ship
  HTML tables under an `.xls` extension.
- **No sheet is ever silently discarded.** Sheets are classified rather than
  filtered — lookup lists into enum sources, summary tabs into dashboard
  metrics, pivot tables and chart sheets into real charts — and every sheet is
  additionally kept as a read-only snapshot. Aggressive classification is only
  safe because nothing it gets wrong is unrecoverable.
- **Several tables on one sheet are detected and split.** A declared table
  wins outright over any inference. Candidate regions with matching headers are
  proposed as one table rather than two, so a spacer row doesn't fracture real
  data, and the review screen confirms the split before it stands.
- **Scale is a routing decision, not a wall.** Sizing happens before parsing,
  large workbooks offer sheet-by-sheet selection, import is streamed rather
  than held in memory, and a workbook too large for a phone is imported on a
  desktop and synced down through its durable home. Thresholds adapt to the
  device instead of being fixed, and anything omitted is named.
- **Product name** — *Sheaf*, with *"Your spreadsheet, as an app on your
  phone"* carrying the descriptive and search burden.
