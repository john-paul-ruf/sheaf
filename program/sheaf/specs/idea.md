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

There is no server, and there never will be. The site is static, the data
lives on the device, and the app is installable and fully usable offline. But
"no server" is not the same as "trapped on one phone." The honest promise is
not that data never leaves the device — it is that **the data is never
readable by anyone but you.** Everything that syncs is end-to-end encrypted
with keys that exist only on the user's own devices, and it travels over
substrate the user already owns: an encrypted bundle file they can put
anywhere, a folder in their own Google Drive, Dropbox, or OneDrive, or a
direct device-to-device connection when both are present. Apple offers no
third-party web API for iCloud Drive, so iCloud remains an upload source but
never an automatic sync substrate — a limitation the product states plainly
rather than letting users assume otherwise. That yields multi-device sync,
real backup, and the ability to hand an app to a colleague — with nothing to
run, nothing to pay for, and no third party who can read a single row.

Reconciling divergent copies is the engine that makes that possible, and it is
the same engine that lets a user re-upload a newer version of a workbook and
have it merge into the app they've already been using. Two devices that edited
offline and a freshly re-uploaded file are the same problem wearing different
clothes: two versions of one dataset that must be resolved field by field. One
engine, both features. That engine is not a bonus — it is structural.

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
   attachment. Multi-sheet workbooks.
2. **Structural inference** — real header row located, junk rows discarded,
   non-table sheets recognized as such.
3. **Type inference** — date, currency, number, phone, email, URL, address,
   boolean, enum, free text, reference.
4. **Relationship detection** — cross-sheet foreign keys, with the user's own
   lookup formulas as the primary signal and key-column matching as the
   secondary one.
5. **Plain-language review** — one onboarding confirmation screen, in the
   user's words, not the schema's.
6. **Permanently editable schema** — every inference is revisable at any time,
   from inside the app, forever.
7. **Live formula engine** — computed columns, table metrics, and standalone
   dashboard values, translated off cell addresses, recalculating on edit and
   editable by the user. Clock-volatile functions (`TODAY`, `NOW`) stay live
   and are never stored, so they can never conflict; nondeterministic ones
   (`RAND` and family) are frozen at import, because a value that differs per
   device would break reconciliation. A formula using an unsupported function
   keeps its imported value, shows its original text for rewriting, and leaves
   newly created rows **empty and flagged rather than silently zero**.
8. **Relational tables with navigable relationships** — tap a customer, see
   their orders.
9. **Full CRUD with mobile-native input** — right keyboard per type, native
   date picker, bottom-sheet pickers, phone numbers dial, addresses open Maps,
   validation on every write.
10. **Query surface** — sticky search, horizontal filter chips, sort.
11. **First-class charts** — bar, line, pie, scatter, stacked; cross-sheet
    charts over detected relationships; saved and pinned to an app's home;
    touch-native, where tapping a bar filters the list beneath it.
12. **Per-app identity** — built-in themes plus per-app customization: color,
    accent, density, light/dark, logo.
13. **Installable, offline-first PWA** — with active pressure toward home-screen
    install and persistent storage, because on some platforms that is a
    data-integrity requirement rather than a nicety.
14. **End-to-end encrypted sync, backup, and sharing** — layered across
    encrypted bundle files, user-owned cloud folders, and direct
    device-to-device connections, with no server and no readable copy anywhere.
15. **Merge and reconciliation engine** — resolves divergent copies field by
    field; powers both multi-device sync and re-uploading a newer version of an
    already-imported workbook.
16. **Export** — XLSX, CSV, chart PNG, and PDF reports, at any time.
17. **The shell** — a library of every generated app, each a tile with name,
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
- **Not a BI or data-warehouse tool.** No SQL surface, no joins the user has to
  author, no modeling layer.
- **No telemetry on user data.** Nothing about the contents of a workbook is
  measured, transmitted, or retained anywhere off-device.

---

## Open Questions

To be resolved during the `requirements` phase.

- **Input formats.** Beyond `.xlsx`: is `.xls`, `.csv`, `.tsv`, Google Sheets
  export, and Apple Numbers in the accepted set, and does each get the full
  inference pipeline or a reduced one?
- **Non-table sheets.** What happens to a summary tab, a pivot table, a chart
  sheet, or a page of notes — dropped, preserved read-only, or converted into
  dashboard content?
- **Multiple tables on one sheet.** Two side-by-side or stacked tables on a
  single sheet: detected and split, or one-table-per-sheet as a hard rule?
- **Sharing semantics.** Does a shared app sync bidirectionally with the
  recipient, or is there a read-only share as well? Can the sender revoke?
- **Scale ceiling.** What is the largest workbook the product commits to
  handling on a phone — in rows, sheets, and megabytes — and what does it do at
  the boundary?

### Settled during the idea phase

Recorded here so later phases don't relitigate them.

- **Encryption is mandatory wherever a backup leaves the device.** An
  unreadable-by-anyone-but-you guarantee is the product's core claim, and an
  unencrypted blob in someone's Drive would forfeit it outright.
- **Symmetric keys only, no public-key infrastructure.** One key per app,
  reaching a second device by QR pairing and recoverable by a written code, with
  an optional passphrase wrap. Sharing is delegated to the storage provider's
  own folder sharing rather than to a trust model the product would have to
  build and maintain.
- **Cloud substrate, in order:** encrypted bundle file, Google Drive, Dropbox,
  OneDrive, and a picked local folder on desktop. iCloud Drive is excluded, for
  the reasons given in the Vision.
- **No secrets, no API keys, no paid infrastructure.** The site is a public
  static deploy from a public repository. Provider integration uses public
  OAuth client identifiers with PKCE and app-folder-scoped permissions, held in
  build-time configuration that a fork can supply for itself.
- **Peer-to-peer sync is an accelerator, never the guarantee.** In-person
  pairing works with no infrastructure at all. Remote peer connections are
  best-effort, because a guaranteed relay would require credentials the project
  cannot publish. The cloud folder is always the reliable path.
- **Formula fidelity policy** — as recorded in Key Features 7.
- **Product name** — *Sheaf*, with *"Your spreadsheet, as an app on your
  phone"* carrying the descriptive and search burden.
