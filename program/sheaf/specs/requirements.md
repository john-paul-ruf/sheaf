# Requirements — Sheaf

> Derived from `specs/idea.md`, approved. Every requirement below traces to a
> Key Feature (`KF-n`), a Non-Goal (`NG`), or a decision settled during the
> idea phase or this one. Tags in parentheses give that trace.

This document is **tech-agnostic**. It states what the product must do, never
how. Stack, storage engine, libraries, and schema are Architect's and DB's to
choose.

---

## Reading This Document

- **FR-n** — functional requirement, with a user story and testable acceptance
  criteria.
- Acceptance criteria are written so that a build session can prove each one
  true or false. "Visibly", "plainly", and "named" always mean *on screen, in
  the user's language, without them going looking for it.*
- **Prohibitions are requirements.** Several criteria below forbid a behaviour
  rather than demand one — silent truncation, silent deletion, silent conflict
  resolution. These are testable and are not optional polish.

---

# Functional Requirements

## §1 — Import & Inference

### FR-1: Upload from anywhere
*(KF-1)*

- **User story:** As someone whose workbook lives wherever it happens to live,
  I want to bring it in from any source my device can reach, so that getting
  started doesn't require moving the file first.
- **Acceptance criteria:**
  - [ ] Upload accepts files from the device filesystem, the platform file
        picker, cloud storage the picker exposes (including iCloud Drive), and
        share/open-in targets from other applications.
  - [ ] `.xlsx`, `.xlsb`, `.xls`, and `.ods` are read with all structure they
        declare — declared tables, validation rules, number formats, formulas,
        and multiple sheets.
  - [ ] `.csv` and `.tsv` import value-only, with no structure assumed.
  - [ ] A delimited-text import can be directed into an **existing** app as a
        new table rather than creating a new app.
  - [ ] Format is determined by **file content**, never by file extension.
  - [ ] A file whose content contradicts its extension is handled by its
        content, and the discrepancy is stated to the user.
  - [ ] iCloud Drive is accepted as an upload **source** and is never offered
        as a durable home. Where a user might expect otherwise, the app says
        why.

### FR-2: Refusal of unsupported and unsafe input
*(NG: macros; NG: universal file reader)*

- **User story:** As a user, I want to be told clearly that a file cannot be
  used and what to do instead, rather than receiving a half-parsed app I
  cannot trust.
- **Acceptance criteria:**
  - [ ] A workbook containing VBA or macro content is **refused at import** —
        not partially parsed, not stripped and continued.
  - [ ] The macro refusal names macros as the reason and offers the specific
        remedy of re-uploading a macro-free copy.
  - [ ] Apple Numbers, Pages, and PDF files are refused with specific
        instructions for producing an Excel export instead.
  - [ ] No refusal leaves a partial app, an empty app, or an orphaned record
        behind.
  - [ ] Refusal messages name the file and the reason in the user's language,
        never an error code alone.

### FR-3: Pre-flight sizing and sheet selection
*(KF-18; "Import scale is a routing decision")*

- **User story:** As someone with a large workbook on a phone, I want to know
  before anything starts whether this device can handle it, so that I am not
  told after a five-minute wait.
- **Acceptance criteria:**
  - [ ] A sizing pass runs **before any sheet's cell data is parsed** and
        reports sheet count, approximate row counts, and whether this device
        can complete the import. It necessarily reads workbook metadata and
        declared structure — sheet names, declared dimensions, declared tables
        — since that is what makes sizing possible; what it must not do is
        parse the cell data it is sizing.
  - [ ] Where the workbook exceeds the device's import budget, sheet-by-sheet
        selection is offered so the user can import a subset.
  - [ ] Import is streamed; the whole workbook is never required in memory at
        once.
  - [ ] Import progress is visible and reports which sheet is being processed.
  - [ ] A cancelled import leaves no partial app.

### FR-4: Structural inference
*(KF-2; "Several tables on one sheet are detected and split")*

- **User story:** As someone whose sheet has a title, a blank row, and then
  the real headers, I want the app to find the actual table, so that my junk
  rows don't become records.
- **Acceptance criteria:**
  - [ ] The real header row is located, and rows above it are excluded from
        data.
  - [ ] A table the workbook **declares** wins outright over any inference.
  - [ ] Multiple tables on one sheet are detected and split into separate
        tables.
  - [ ] Adjacent candidate regions with matching headers are proposed as
        **one** table, so a spacer row does not fracture real data.
  - [ ] Every split, merge, and discarded-row decision is shown on the review
        screen (FR-8) before it stands.
  - [ ] Discarded rows are retained in the sheet snapshot (FR-5) and are
        recoverable.

### FR-5: Sheet classification and snapshot retention
*(KF-3; "No sheet is ever silently discarded")*

- **User story:** As someone with a summary tab and a lookup list, I want each
  sheet used for what it actually is, without losing anything I can't see the
  app using.
- **Acceptance criteria:**
  - [ ] Lookup lists are classified as enum sources.
  - [ ] Summary tabs are classified into dashboard metrics.
  - [ ] Pivot tables and chart sheets are rebuilt as real charts (FR-16), so
        an app opens with the user's own charts already on it.
  - [ ] **Every** sheet is additionally retained as a read-only snapshot,
        including sheets that were classified, split, or found unusable.
  - [ ] Snapshots are reachable from inside the app at any time.
  - [ ] No sheet is dropped, and no sheet is excluded from the review screen.

### FR-6: Column type inference
*(KF-4)*

- **User story:** As a user, I want each column to know what it holds, so that
  I get the right keyboard, the right picker, and validation that catches my
  mistakes.
- **Acceptance criteria:**
  - [ ] The following types are inferable: date, currency, number, phone,
        email, URL, address, boolean, enum, free text, and reference.
  - [ ] The workbook's own number formats and validation rules are used as the
        type source **wherever they exist**.
  - [ ] Value-based inference is used only where the workbook declares
        nothing.
  - [ ] Every inferred type is shown on the review screen with the evidence
        behind it stated in plain language.
  - [ ] Values that do not match their column's inferred type are preserved,
        flagged, and never coerced or discarded.

### FR-7: Relationship detection
*(KF-5)*

- **User story:** As someone who wrote a `VLOOKUP` between two sheets, I want
  the app to understand that as a relationship, because I already declared it.
- **Acceptance criteria:**
  - [ ] The user's own lookup formulas (`VLOOKUP`, `XLOOKUP`, and equivalents)
        are the **primary** signal for foreign-key detection.
  - [ ] Key-column matching is the **secondary** signal.
  - [ ] Each detected relationship is shown on the review screen naming which
        signal produced it.
  - [ ] Relationships are editable at review time and at any time afterward
        (FR-15).
  - [ ] A relationship the user rejects is not silently re-detected on a later
        import.

### FR-8: Plain-language review
*(KF-6)*

- **User story:** As a non-developer, I want to confirm what the app inferred
  in words I understand, once, before I start using it.
- **Acceptance criteria:**
  - [ ] Exactly one review screen runs, at the end of import.
  - [ ] It presents header rows, discarded rows, table splits, column types,
        enums, relationships, formulas, and sheet classifications.
  - [ ] Every statement is in the user's language, not schema language — e.g.
        *"Status looks like a dropdown with four options. Correct?"*
  - [ ] Every inference is editable from this screen.
  - [ ] Accepting the screen is explicit; there is no timeout or auto-accept.
  - [ ] The review screen **never runs for an adopted app** (FR-30).

### FR-9: The import contract
*("supported structures become interactive, unsupported content is preserved
and visibly identified")*

- **User story:** As a user handing over a workbook I built over years, I want
  to know exactly what the app can actually do with each part of it, and to
  find the parts it can't.
- **Acceptance criteria:**
  - [ ] Supported structures become interactive.
  - [ ] Unsupported content is **preserved** and **visibly identified** — never
        silently dropped and never silently inert.
  - [ ] Preserved-but-inert content is listed somewhere the user can find it,
        with what it was and why it is inert.
  - [ ] The product never implies that preserving content is the same as
        reproducing its behaviour.
  - [ ] This contract applies uniformly to formulas, formatting, charts, and
        layouts — no per-feature carve-outs.

### FR-10: Desktop handoff for oversized imports
*(KF-18)*

- **User story:** As someone whose workbook is simply too big for my phone, I
  want a route that still ends with the app on my phone.
- **Acceptance criteria:**
  - [ ] When a phone genuinely cannot parse a workbook, a handoff to a desktop
        browser is offered with clear instructions.
  - [ ] After a desktop import, the finished app reaches the phone through its
        durable home (FR-30), with no re-parse and no second review screen.
  - [ ] The handoff states plainly that it solves **importing only**, and that
        storing, querying, charting, and syncing budgets still apply on the
        phone (FR-34).

---

## §2 — The Generated App

### FR-11: Relational tables with navigable relationships
*(KF-9)*

- **User story:** As a user, I want to tap a customer and see their orders,
  because that is the relationship I have been holding in my head.
- **Acceptance criteria:**
  - [ ] Each detected table is a typed, browsable table.
  - [ ] Detected relationships are navigable in both directions — from parent
        to related children, and from a child to its parent.
  - [ ] A reference value renders as the related record's human label, not a
        raw key.
  - [ ] A reference pointing at a missing record is shown as broken and
        flagged, never rendered as blank or as a raw key with no explanation.

### FR-12: Full CRUD with mobile-native input
*(KF-10)*

- **User story:** As someone entering data one-handed in a truck, I want the
  right input for each field, so that data entry is not an act of hostility.
- **Acceptance criteria:**
  - [ ] Create, read, update, and delete are supported for every table.
  - [ ] Each column type presents its correct input: numeric keypad for
        currency and number, native date picker for dates, bottom-sheet picker
        for enum and reference, email and URL keyboards for their types.
  - [ ] Phone numbers are tappable to dial.
  - [ ] Addresses are tappable to open the platform's maps application.
  - [ ] Validation runs on every write, and a failed validation explains what
        is wrong in the user's language.
  - [ ] Validation covers **column-level** rules (type, required, enum
        membership, referential integrity) and **record-level** rules that span
        more than one field — for example, an end date that must not precede
        its start date.
  - [ ] Record-level rules are inferred where the workbook declares them, and
        are editable by the user (FR-15) like any other inference.
  - [ ] **The same validation is applied to a merged result** before it is
        accepted, not only to a user's own keystrokes (FR-32). Validation that
        exists only on the input path cannot protect the merge path.
  - [ ] Primary actions are reachable in the thumb zone on a phone.
  - [ ] Deletes are recoverable through the change log (FR-28) rather than
        being immediately destructive.
  - [ ] Any user-authored change triggers the durable-home reminder (FR-25).

### FR-13: Query surface
*(KF-11)*

- **User story:** As a user with a few hundred records, I want to find one
  quickly without learning a query language.
- **Acceptance criteria:**
  - [ ] Search is sticky and available without scrolling to reach it.
  - [ ] Filter chips are presented horizontally and are type-aware.
  - [ ] Sort is available on any column.
  - [ ] Active filters are visible and individually clearable.
  - [ ] There is **no SQL surface and no user-authored join** (NG: BI tool).
  - [ ] Where a query exceeds the device's query budget, results degrade
        visibly and the omission is named (FR-34).

### FR-14: Live formula engine
*(KF-8)*

- **User story:** As someone whose workbook is full of formulas, I want them
  to keep working — and to keep working when I add a row.
- **Acceptance criteria:**
  - [ ] A filled-down formula becomes a **live computed column**.
  - [ ] A `SUM` or equivalent at the foot of a column becomes a **table
        metric**.
  - [ ] Standalone dashboard values are supported.
  - [ ] Formulas are translated off cell addresses into durable column
        expressions.
  - [ ] Computed values recalculate on edit.
  - [ ] Formulas are editable by the user.
  - [ ] Clock-volatile functions (`TODAY`, `NOW`) stay live and are **never
        stored**, so they can never produce a conflict.
  - [ ] Nondeterministic functions (`RAND` and family) are **frozen at
        import**, because a per-device value would break reconciliation.
  - [ ] A formula using an unsupported function keeps its imported value,
        displays its original text for rewriting, and leaves newly created
        rows **empty and flagged — never silently zero**.

### FR-15: Permanently editable schema
*(KF-7)*

- **User story:** As a user whose needs changed after onboarding, I want to fix
  any inference at any time, not just during a review screen I already passed.
- **Acceptance criteria:**
  - [ ] Column types, enum option sets, relationships, computed columns, table
        names, and column names are all editable from inside the app, at any
        time, forever.
  - [ ] A schema edit that would invalidate existing values shows what will be
        affected, with counts, before it is applied.
  - [ ] No schema edit silently discards data; affected values are preserved
        and flagged.
  - [ ] Schema edits are user-authored changes and are recorded in the change
        log (FR-28) and trigger the durable-home reminder (FR-25).

### FR-16: First-class charts
*(KF-12)*

- **User story:** As someone who has never gotten a decent chart out of my own
  data, I want one on my phone in seconds.
- **Acceptance criteria:**
  - [ ] Bar, line, pie, scatter, and stacked chart types are supported.
  - [ ] Charts can be built across sheets using detected relationships.
  - [ ] Charts are saveable with a name and pinnable to an app's home view.
  - [ ] Charts are touch-native: tapping a bar or segment filters the list
        beneath it.
  - [ ] Charts rebuilt from imported pivot tables and chart sheets appear
        without the user creating them (FR-5).
  - [ ] Where a chart exceeds the device's charting budget, it degrades
        visibly and the omission is named (FR-34).

### FR-17: Per-app identity
*(KF-13)*

- **User story:** As a user with ten different workbooks, I want each app to
  look like its own thing, so it feels like *my* app rather than a generic
  tool.
- **Acceptance criteria:**
  - [ ] A set of built-in themes is available.
  - [ ] Per-app customization covers colour, accent, density, light/dark, and
        a logo.
  - [ ] Theme is stored per app, not globally, and survives sync and adoption.
  - [ ] Changing a theme is a user-authored change (FR-25, FR-28).

### FR-18: Export
*(KF-19; "Encryption is mandatory ... and deliberately absent from exports")*

- **User story:** As a user, I want my data back out in a form something else
  can open, at any time.
- **Acceptance criteria:**
  - [ ] Export to XLSX, CSV, chart PNG, and PDF report is available at any
        time.
  - [ ] Exports are written **in the clear**, by design.
  - [ ] At the moment of export the app states plainly that the exported file
        is unencrypted and carries none of the product's guarantee.
  - [ ] Export remains available for an **oversized-local** app — one whose
        data is on this device but which exceeds the storing budget, so entry
        is disabled (FR-34).
  - [ ] Export is available while the app is offline **for any app whose data
        is present on this device.** An app that is only *listed* — discovered
        in a durable home but never adopted, or refused adoption on capacity
        grounds — has no local data and therefore cannot be exported here. The
        shell says so and directs the user to a device that can hold it
        (FR-30, FR-34).

---

## §3 — The Shell & Install

### FR-19: The shell
*(KF-20)*

- **User story:** As a user with several apps, I want one home screen that is
  just my library.
- **Acceptance criteria:**
  - [ ] Every generated app appears as a tile showing name, row count, theme,
        and last-opened time.
  - [ ] The tile additionally shows durable-home status: *scratch*, last
        successful backup, and count of device-only changes (FR-26).
  - [ ] The shell offers uploading a new workbook.
  - [ ] The shell is the launch destination; no app opens automatically.
  - [ ] The shell distinguishes three states on the tile, because they afford
        different actions (FR-34):
        **present** (data is on this device);
        **oversized-local** (data is here, entry disabled on capacity grounds);
        **listed-only** (discovered in a durable home, not adopted — no local
        data at all).
  - [ ] A **listed-only** tile is never labelled merely "disabled." It states
        that the app lives in the durable home and is not on this device, which
        is a different fact with different remedies.
  - [ ] Row count and last-opened time are shown for a listed-only tile only
        where the durable home's index supplies them; where it does not, the
        tile omits them rather than displaying zero.

### FR-20: Installable, offline-first
*(KF-14; NG: network-dependent)*

- **User story:** As someone who works without signal, I want the app to open
  and work with no network at all.
- **Acceptance criteria:**
  - [ ] The application is installable to the device home screen.
  - [ ] Launching, reading, writing, searching, charting, and exporting all
        work with **no** network connection.
  - [ ] The application launches from the local store and **never waits on a
        network** to become usable.
  - [ ] There is no sign-in on the launch path.
  - [ ] Home-screen install is encouraged for the experience and is **not**
        required for data safety — durability is the durable home's job.
  - [ ] A signed-out device is a fully working device.

### FR-21: Account isolation
*(NG: multi-tenant SaaS; NG: sharing; NG: multi-account)*

- **User story:** As a user, I want an absolute guarantee that no one else's
  apps can appear in my library and mine cannot appear in theirs.
- **Acceptance criteria:**
  - [ ] Discovery is scoped to the signed-in storage account and to nothing
        else.
  - [ ] One account can never enumerate another account's apps, under any
        circumstance, and this is enforced rather than defaulted.
  - [ ] There is no sharing surface of any kind: no shared folders, no
        invitations, no links, no recipients, no permissions, no revocation.
  - [ ] There is no co-editing, no presence, no comments, and no live session.
  - [ ] There are no accounts of our own, no server-side identity, and no
        administrative backend.
  - [ ] A device may connect **more than one** storage account belonging to the
        same person; each app has exactly one durable home, and isolation
        between accounts still holds.

---

## §4 — Keys & Local Security

> The security model changed in this phase. The idea required encryption only
> for what is written to a durable home; the builder has additionally required
> **encryption at rest on the device, behind a passphrase entered at launch.**
> The named adversary is therefore broadened from *us and the storage
> provider* to include *anyone in physical possession of the device.*

### FR-22: Local unlock and encryption at rest
*(Builder decision, this phase)*

- **User story:** As a user whose phone could be lost or stolen, I want my
  records encrypted on the device and locked behind my passphrase, so that
  holding my phone is not the same as reading my data.
- **Acceptance criteria:**
  - [ ] All app data, schema, themes, saved charts, sheet snapshots, and the
        change log are encrypted at rest on the device.
  - [ ] A cold launch presents a local unlock prompt before any app data is
        readable or any tile shows its contents.
  - [ ] Unlock requires **no network** and no storage provider; the app is
        fully usable offline the moment it is unlocked. This does not violate
        FR-20 — the prohibition there is on a *sign-in* on the launch path, not
        on a local secret.
  - [ ] Unlock persists for the session. The app re-locks on termination and
        on a user-configurable idle timeout, which is **off by default** so
        that field use is not interrupted.
  - [ ] Failed unlock attempts are rate-limited with escalating delay.
  - [ ] There is **no attempt cap that destroys data.** A wipe is only ever
        reached through the explicit reset path in FR-23.
  - [ ] The unlock screen states that a forgotten passphrase cannot be
        recovered, and offers the **local recovery code** path (FR-23) before
        it offers reset. That code is issued at initial setup, so this path
        exists for every user — including one who has never created a durable
        home and therefore has no vault.
  - [ ] Exported files (FR-18) are outside this guarantee, by design, and the
        app says so.

### FR-23: Passphrase change, reset, and recovery codes
*(Builder decision, this phase; "A written recovery code remains available")*

- **User story:** As a user, I want to change my passphrase without losing
  anything — and, if I have genuinely lost it, I want a way forward that
  cannot be triggered by accident.
- **Acceptance criteria:**
  - [ ] **Change** (current passphrase known) re-wraps the keys, requires the
        current passphrase, and **loses no data**.
  - [ ] **Reset** (current passphrase unknown) is a separate, destructive
        action requiring at least three explicit confirmations, one of which
        requires typing a confirmation phrase rather than tapping.
  - [ ] **The reset confirmation is detailed only when the store can actually
        be read.** Reset is reached from two different states, and the product
        must not promise an inventory it cannot produce:
  - [ ] *Unlocked, or holding a valid **local** recovery code* — the app
        enumerates exactly what will be destroyed: each app by name, its record
        count, and its last successful backup time.
  - [ ] *Locked, with no **local** recovery code* — the store is undecryptable by
        definition (FR-22), so the app **cannot** enumerate anything. The
        confirmation is generic: it states that every app on this device will
        be destroyed, that the number and names of those apps cannot be shown
        **because they are encrypted**, and that this inability is the
        encryption working as intended.
  - [ ] **No plaintext inventory of apps, record counts, or backup times is
        retained on the device for the purpose of populating this screen.**
        Retaining one would defeat FR-22 to improve a confirmation dialog.
  - [ ] Reset wipes the local store and establishes a new vault.
  - [ ] Reset **does not delete ciphertext already written to a durable home.**
        A user who later remembers that home's passphrase, or finds its
        **vault** recovery code, can still recover from it — on this device or
        any other. Destroying that copy is a separate, separately-confirmed
        action (FR-33).
  - [ ] **What survives a reset is the last successfully backed-up state, not
        the app.** Device-only changes (FR-26) are destroyed by reset exactly
        as they are by removal (FR-33), and the confirmation must not imply
        otherwise. "Has a durable home" is not "is backed up."
  - [ ] The generic (locked) reset therefore states three things: that an app
        with a durable home can be re-adopted later **at its last successful
        backup**; that anything changed on this device since that backup is
        **destroyed**; and that a **scratch** app is destroyed entirely.
  - [ ] The same confirmation states that it **cannot say how many such
        changes exist, or which apps they belong to**, because that count is
        itself encrypted — consistent with the generic confirmation above.
  - [ ] Where reset is reached **unlocked or with a valid local recovery
        code**, the
        enumeration includes the device-only change count per app, since it can
        be read. A user who can see the number is entitled to see it before
        destroying it, and should be offered backup or export first (FR-26,
        FR-18).
  - [ ] **There are two recovery codes, because there are two things to
        recover.** A user who never creates a durable home must still be able
        to recover this device, so a recovery code cannot be tied to vault
        creation alone (FR-24: a scratch app has no vault).
  - [ ] **Local recovery code** — generated at **initial setup**, when the
        local unlock passphrase is first created, before and independently of
        any durable home. It unlocks **this device's store without data loss**
        (FR-22). It confers nothing on any other device.
  - [ ] **Vault recovery code** — generated at **vault creation**, one per
        durable home. It opens **that home's vault on any device**, so its apps
        can be adopted (FR-30). It does not unlock any device's local store.
  - [ ] Because a local unlock passphrase always exists, a **local recovery
        code always exists**, so FR-22's unlock screen can always offer the
        recovery path ahead of reset. It is never offered when it does not
        exist.
  - [ ] Each code is displayed once at creation and is re-viewable while the
        thing it protects is unlocked.
  - [ ] Where the user accepts FR-24's offer to use one passphrase for both,
        the two codes are **still issued separately** — they recover different
        things — but are presented together at first run, each labelled with
        what it recovers, so the user writes down one thing once.
  - [ ] **Where the passphrases differ, every prompt names which secret it
        wants** — this device's unlock, or a specific durable home's vault —
        and never asks for "your passphrase" unqualified.
  - [ ] The product states plainly, at each code's creation, exactly what is
        unrecoverable if both that passphrase and that code are lost: for the
        local code, this device's store; for a vault code, that home's apps —
        unrecoverable by anyone, including us.

### FR-24: The vault and key layers
*(KF-16; "Passphrase-derived keys in two layers")*

- **User story:** As a user setting up a second device, I want to type my
  passphrase and find my apps — with no pairing, no key exchange, and nothing
  transferred between the devices themselves.
- **Acceptance criteria:**
  - [ ] A passphrase derives a **vault key**.
  - [ ] The vault holds the encrypted index of apps and each app's own key,
        wrapped.
  - [ ] A device holding only the passphrase can therefore discover what
        exists, without already holding a per-app key.
  - [ ] Per-app keys exist for blast-radius containment: one compromised app
        key exposes one app, never the library.
  - [ ] **There is one vault per durable home** — not per storage account.
        A cloud account's home carries one vault; a bundle file *is* a
        self-contained vault plus the apps it holds. This is what makes a
        bundle work at all, since a bundle has no account to be scoped to.
  - [ ] **A scratch app has no vault**, because it has no durable home. Its
        app key lives only in the local store and is protected by local
        at-rest encryption (FR-22) — so a scratch app is still encrypted on
        the device, it simply has nowhere to be recovered from.
  - [ ] **The local store is therefore protected independently of any vault**,
        and carries its own recovery code issued at initial setup (FR-23). A
        user who only ever creates scratch apps never creates a vault, and must
        still be able to recover this device.
  - [ ] When a scratch app is given a durable home (FR-25), its app key is
        wrapped into that home's vault, and the app stops being scratch. No
        re-encryption of the user's data is required for this to happen.
  - [ ] There is **no public-key infrastructure, no pairing ceremony, and no
        key exchange**. Nothing is ever transferred device to device (NG:
        peer-to-peer).
  - [ ] On first run, when the user is creating their first vault, the app
        offers to use the same passphrase for the local unlock (FR-22) and the
        vault, so there is one secret to remember. The two remain separable,
        and their recovery codes remain distinct (FR-23).
  - [ ] Connecting a second durable home whose vault uses a different
        passphrase prompts for that passphrase **once**; its vault key is then
        held inside the encrypted local store and is not re-typed at launch.
  - [ ] Opening a bundle file whose vault uses a different passphrase prompts
        for that passphrase at open time, on the same terms.

---

## §5 — Durable Home & Backup

### FR-25: Durable home selection and the scratch reminder
*(KF-15; builder decision, this phase)*

- **User story:** As a user, I want to try the product in ten seconds without
  setting anything up — and I want to be told, insistently, once I start
  putting real data in, that this is not backed up.
- **Acceptance criteria:**
  - [ ] A new app is created as **scratch** and is immediately, fully usable:
        import, browse, chart, and export all work with no durable home.
  - [ ] A durable home is one of: a folder in the user's own Google Drive,
        Dropbox, or OneDrive, or an encrypted bundle file the user saves
        wherever they like.
  - [ ] **Any user-authored change** — creating, editing, or deleting a record,
        editing schema, saving a chart, or changing a theme — triggers a
        reminder that the app needs a durable home.
  - [ ] The reminder is **never a hard block.** It carries a dismissal, and the
        user may continue working.
  - [ ] The reminder returns at escalating intervals for as long as the app
        remains scratch.
  - [ ] A scratch app carries a **persistent visible badge** in the shell and
        inside the app, stating plainly that it is not backed up, until a home
        is chosen.
  - [ ] Choosing a bundle file as the home states plainly, **at the moment of
        choosing**, that a bundle cannot be enumerated and its apps must be
        opened by hand on another device (FR-30).
  - [ ] iCloud Drive is never offered as a durable home, and where a user
        might expect it, the reason is stated.

### FR-26: Backup freshness and observability
*(KF-15; "Durability is achievable and observable, never solved")*

- **User story:** As a user, I want to know whether my data is actually backed
  up right now — not merely that I once configured a place for it.
- **Acceptance criteria:**
  - [ ] Every app surfaces **when it last backed up successfully** and **how
        many changes exist only on this device.**
  - [ ] Both are visible from the shell tile and from inside the app.
  - [ ] A one-tap **back up now** action is available wherever that status is
        shown — observability without a remedy is prohibited.
  - [ ] **Durability never depends on a termination event.** Mobile platforms
        may terminate a backgrounded application without dispatching a
        reliable close or unload event, so no requirement here may be
        satisfied by work scheduled for app close.
  - [ ] Every user-authored change is **durably recorded to the local store
        before it is acknowledged** to the user. A change the user has seen
        accepted survives an abrupt termination.
  - [ ] Automatic backup runs **debounced during use** and **best-effort on
        backgrounding** — the last point at which execution is reliably
        available.
  - [ ] Backup that did not complete is **retried when execution next
        resumes**, without the user asking.
  - [ ] **Backup status reflects confirmed completion only.** The last-backup
        time advances when the durable home has acknowledged the write —
        never when a backup was merely started, queued, or attempted.
  - [ ] An interrupted backup leaves the durable home in a readable state; a
        partial write is never presented as a successful backup, and never
        corrupts the prior good copy.
  - [ ] A backup that fails — expired token, filled quota, no network,
        interrupted transfer — states which, and the app remains fully usable.
  - [ ] A bundle-file home cannot be written automatically; it is manual-only,
        goes stale the moment a record changes, and is **the loudest** of all
        home types about that staleness.
  - [ ] Backup never blocks reading, writing, or searching.

### FR-27: End-to-end encryption of everything written to a durable home
*(KF-16)*

- **User story:** As a user, I want a guarantee that neither the makers of this
  product nor my storage provider can read a single row.
- **Acceptance criteria:**
  - [ ] **Everything** written to a durable home is encrypted under a
        passphrase-derived key before it leaves the device.
  - [ ] No plaintext of user data, schema, table names, or column names is
        written to a durable home.
  - [ ] There is no server of ours, and no readable copy exists in any cloud.
  - [ ] Deliberate exports (FR-18) are the sole exception and are plaintext by
        design.
  - [ ] The distinction between the two is stated to users, not assumed.

### FR-28: Change log and compaction
*("Storage format is an append-only change log with periodic compaction")*

- **User story:** As a user, I want saving a record to be fast, and I want the
  system to be able to reconcile two copies of my data — which requires it to
  remember what changed.
- **Acceptance criteria:**
  - [ ] Changes are recorded as an **append-only log**.
  - [ ] A save writes a delta; it never rewrites the whole dataset.
  - [ ] The log is compacted periodically.
  - [ ] Deletes are recorded in the log rather than removing history, so they
        can participate in reconciliation and be recovered (FR-12).
  - [ ] The log is encrypted at rest locally (FR-22) and in the durable home
        (FR-27).
  - [ ] **A baseline is retained for every row.** The baseline is the row's
        value as of the last point at which this device and its counterpart
        are known to have agreed — the original import for a re-uploaded
        workbook, or the last successful reconciliation for a second device.
        Without it, "changed on one side" and "changed on both sides" are not
        distinguishable (FR-32).
  - [ ] **Compaction never discards a baseline reconciliation still requires.**
        Compaction may collapse intermediate history, but it must preserve the
        agreed-value baseline for any row that could still take part in a
        merge.
  - [ ] Where a baseline is genuinely unavailable — it was compacted away, the
        app was adopted without one, or the counterpart has no shared history —
        the row is marked **baseline-absent**, and reconciliation falls back to
        the conservative behaviour required by FR-32.
  - [ ] A retained baseline is subject to the same encryption as the rest of
        the store, and to the same capacity accounting (FR-34).

---

## §6 — Adoption, Sync & Merge

### FR-29: One reconciliation engine
*(KF-17; "One engine, both features")*

- **User story:** As a user, I want offline edits, a second device, and a
  re-uploaded newer workbook to all behave consistently, because to me they
  are the same problem.
- **Acceptance criteria:**
  - [ ] A single reconciliation engine serves the offline write queue,
        multi-device sync, and workbook re-upload (FR-31).
  - [ ] Writes made offline queue locally and flush when connectivity returns.
  - [ ] Queued writes are visible as the device-only change count (FR-26).
  - [ ] Divergence between copies is resolved **field by field**, never by
        wholesale document replacement.
  - [ ] Reconciliation never blocks launching, reading, writing, or searching.

### FR-30: App discovery and adoption
*(KF-21)*

- **User story:** As someone who created an app on my desktop on Tuesday, I
  want it to turn up on my phone, with nothing to re-parse and no review
  screen to answer twice.
- **Acceptance criteria:**
  - [ ] A device pointed at an existing durable home finds the apps already in
        it and offers them.
  - [ ] Discovery runs **continuously**, not only at install, so apps created
        later still appear.
  - [ ] Adoption re-parses nothing, re-infers nothing, and **never runs the
        review screen a second time** (FR-8).
  - [ ] An adopted app arrives with schema, theme, saved charts, and data
        intact.
  - [ ] Adoption is **selective and lazy** — the user chooses which apps to
        adopt, and **no app payload** downloads until chosen. Discovery
        necessarily reads the vault index and per-app sizing metadata first;
        that is what makes the choice possible, and is not itself adoption.
  - [ ] A sizing check runs **before any app payload is transferred**, so a
        phone is warned that an app exceeds its budget before the download, not
        after (FR-34).
  - [ ] An app whose size exceeds this device's storing budget is **not
        adopted** and is shown as **listed-only** (FR-19) — it remains in the
        durable home, fully intact, and is offered on a device that can hold
        it. It is not "broken" and is not deleted.
  - [ ] A listed-only app offers the remedies that are actually possible
        without local data: open on a desktop or larger device, or free space
        on this one. It does **not** offer export or backup, because there is
        nothing on this device to export or back up (FR-18, FR-34).
  - [ ] A bundle-file home has nothing to enumerate; its apps are opened by
        hand, and this was stated when the home was chosen (FR-25).

### FR-31: Workbook re-upload and row identity
*(KF-17; builder decision, this phase — Q1)*

- **User story:** As a user with a newer version of the same workbook, I want
  to merge it into the app I have been using, without the app guessing which
  row is which.
- **Acceptance criteria:**
  - [ ] Re-uploading a newer workbook merges into the existing app rather than
        creating a duplicate.
  - [ ] Row identity is matched on the table's detected key column where one
        exists.
  - [ ] Where no key column exists, the user is asked to choose a match
        column.
  - [ ] Where the user cannot or will not choose one, the upload lands as a
        **new table** rather than a merge — a merge without identity is a guess
        and is prohibited.
  - [ ] **Identity conflicts are always resolved by the user.** No automatic
        resolution is applied to identity.
  - [ ] Establishing identity is necessary but **not sufficient** to merge. Once
        rows are matched, field-level reconciliation still requires the
        three-way baseline of FR-28 — the values as they stood at the **last
        import of this workbook into this app** — and follows FR-32.
  - [ ] The import baseline is recorded at every import and re-upload, so each
        successive re-upload has a baseline from the one before it.
  - [ ] A first re-upload into an app that has **no** recorded import baseline
        — for example an app adopted from a durable home whose baseline was
        compacted away — is **baseline-absent** and takes FR-32's conservative
        path: every difference is put to the user.
  - [ ] Rows present in the app but **absent** from the re-uploaded file are
        **never** deleted automatically. They are presented as a reviewable
        list for the user to act on.
  - [ ] The product never watches, re-reads, or writes back to the source file
        (NG: not linked to the original file). Re-upload is always
        user-initiated.

### FR-32: Conflict resolution
*(Builder decision, this phase — Q1 and Q2)*

> **Governing principle, from the builder:** *no automatic resolution that
> affects foreign keys or data fidelity.* Automatic merging is permitted only
> where it cannot overwrite a user's value or alter a key.

- **User story:** As a user whose two devices both changed the same record, I
  want to decide what the truth is — not to be told afterward what was chosen
  for me.
- **Acceptance criteria:**

  **Comparison is three-way, against a baseline.**
  - [ ] Every field comparison is **three-way**: baseline, local value,
        incoming value (FR-28). Comparing the two current values alone cannot
        tell "one side changed" from "both sides changed," and doing so is
        prohibited.
  - [ ] *Worked example.* An imported price was `10`; the app now says `12`;
        a re-uploaded workbook says `10`. Three-way says baseline `10`, local
        `12`, incoming `10` — **only the local side moved**, so `12` stands and
        there is no conflict. A two-way comparison would see `12` against `10`
        and either overwrite the user's edit or raise a false conflict. Both
        are defects.
  - [ ] Where a row is **baseline-absent** (FR-28), the engine falls back to
        **conservative behaviour**: any difference between local and incoming
        is treated as a **conflict for the user**, never auto-applied in either
        direction. A missing baseline degrades into more questions, never into
        a silent guess.
  - [ ] The Resolve Conflicts surface states when a conflict arose because the
        baseline was unavailable, so the user understands why they are being
        asked about something that may not be a real disagreement.

  **What merges, and what goes to the user.**
  - [ ] Changes to **different** fields of the same row merge automatically —
        this is a merge, not a conflict — **subject to the merged result
        validating** (below).
  - [ ] A field changed on **one** side only, as established three-way, is
        applied automatically.
  - [ ] A field changed on **both** sides to different values is a **conflict
        and goes to the user.** Last-write-wins is prohibited here.
  - [ ] Any contested change touching a **foreign key or key column** goes to
        the user, without exception.
  - [ ] **Delete-versus-edit** always goes to the user.

  **Automatic merges are provisional until the merged record validates.**
  - [ ] A merged result is **validated before it is applied**, using the same
        validation the app applies to a user-authored write (FR-12), plus
        referential integrity and compatibility with any concurrently merged
        schema change (FR-15).
  - [ ] *Worked example.* A booking runs June 1–10. One device moves the start
        to June 8; another moves the end to June 5. Each edit is individually
        valid and they touch different fields, so field-wise merging would
        produce June 8–June 5 — a record neither user created and that neither
        device would have accepted. This must not be applied.
  - [ ] A merged result that **fails validation is not applied.** The row
        becomes a **record-level conflict** in the pending queue, presented
        with both source versions whole and the reason the combination is
        invalid.
  - [ ] Record-level conflicts are resolved by choosing a whole version or by
        editing the record directly to a valid state — not by per-field
        resolution alone, which is what produced the invalid combination.
  - [ ] Two schema changes that conflict with each other, or a schema change
        that would invalidate data merged alongside it, go to the user rather
        than being applied.
  - [ ] A row with a pending conflict remains readable and editable at its
        local value, and is **visibly flagged**.
  - [ ] Pending conflicts never block launch, read, write, search, or export.
  - [ ] Nothing leaves the pending queue without an explicit user decision.
        There is no timeout, no auto-accept, and no silent resolution.
  - [ ] A **Resolve Conflicts** surface exists, presenting each conflict side
        by side with its source labelled (this device / another device / the
        uploaded file) and its timestamp.
  - [ ] The user can resolve per field, or accept all of one side for a whole
        row.
  - [ ] The same surface carries an **applied log** of changes that merged
        automatically, so automatic merging is auditable and never invisible.

  > **Design note:** the Resolve Conflicts surface is a required mock in the
  > design phase. It carries the product's central integrity promise and must
  > not be left to implementation.

### FR-33: App removal and deletion
*(Builder decision, this phase — Q9)*

- **User story:** As a user, I want to clear an app off this phone without any
  risk of destroying it everywhere.
- **Acceptance criteria:**
  - [ ] **Remove from this device** is local only and is clearly labelled as
        local.
  - [ ] **Removal is only described as reversible when it actually is.**
        Re-adoption restores the *last successful backup* (FR-26) — not the
        current state of the device. A cloud-connected app may hold weeks of
        offline edits that exist nowhere else, and removing it would destroy
        exactly those.
  - [ ] Before any removal, the app computes the **count of device-only
        changes** and the **last successful backup time** for that app.
  - [ ] Where device-only changes are **zero**, removal proceeds as a routine,
        genuinely reversible action, stating what re-adoption will restore.
  - [ ] Where device-only changes are **greater than zero**, removal is
        **treated as destructive**, regardless of whether the app has a durable
        home. This applies to cloud-connected apps, not only scratch ones.
  - [ ] A destructive removal must offer, before confirmation, the remedies
        that would make it non-destructive: **back up now** (FR-26), **save a
        bundle**, or **export** (FR-18).
  - [ ] Where the user declines those remedies, the confirmation **names the
        number of changes that will be lost** and the date they would fall back
        to, and requires an explicit acknowledgement of that loss.
  - [ ] If a backup offered at this point **succeeds**, the app re-computes the
        device-only count and the removal reverts to the routine, reversible
        path — the user is not asked to accept a loss that no longer exists.
  - [ ] **Delete everywhere** touches the durable home, is a separate action,
        and is separately and explicitly confirmed.
  - [ ] The confirmation for **delete everywhere** states that the data cannot
        be recovered and names the app and its record count.
  - [ ] Removing a **scratch** app is destructive by definition, since there is
        no durable home to recover from; the confirmation says so plainly and
        offers export or bundle creation first.
  - [ ] Export (FR-18) is offered at the point of any destructive
        confirmation.

  **Delete everywhere, when another device is offline.**
  - [ ] **Deletion is recorded as a marker in the durable home, not as a bare
        file removal.** To a device that has been offline, an absent app and an
        app it has not yet synced are indistinguishable; only an explicit
        marker separates them.
  - [ ] The deletion marker is **retained** long enough for a long-offline
        device to find it. It is not garbage-collected on a schedule that could
        run before a device reconnects.
  - [ ] **The confirmation states plainly that offline copies do not disappear
        immediately.** A device that is off, uninstalled, or without
        connectivity keeps its copy until it next reconnects, and the product
        does not claim otherwise. Delete-everywhere is not a remote wipe.
  - [ ] On reconnecting and finding the marker, a device **must not silently
        resurrect the app** — it must not re-upload its local copy, recreate
        the app in the durable home, or treat the absence as a sync gap to
        repair.
  - [ ] Neither may it **silently discard** what it holds. A reconnecting
        device with **device-only changes** presents the situation: that the
        app was deleted from the durable home, when, and how many local changes
        exist here that were never backed up. It offers **export** or **save a
        bundle** before removing the local copy, and requires an explicit
        acknowledgement — the same treatment as any destructive removal above.
  - [ ] A reconnecting device with **zero device-only changes** removes its
        local copy and tells the user it did so and why. There is nothing to
        rescue, and silence would be indistinguishable from a bug.
  - [ ] A user who wants the app back after deleting it everywhere must
        re-create it from an export or bundle. The marker is not an undo, and
        the product does not present it as one.

---

## §7 — Capacity

### FR-34: Capacity budgets and entry gating
*(KF-18; builder decision, this phase — Q10)*

> Capacity is **two-tiered**. Query and charting degrade visibly; storage
> capacity gates entry outright. The idea's `degrade visibly` and the builder's
> `if too much data for the device, app entry disabled` both hold — at
> different tiers.

- **User story:** As a user with an app too large for this phone, I want to be
  told that clearly at the door, rather than entering an app that then behaves
  badly.
- **Acceptance criteria:**
  - [ ] Capacity is stated as **five separate budgets**: importing, storing,
        querying, charting, and syncing. They are never collapsed into one
        number.
  - [ ] Each budget **adapts to the device** rather than being a fixed
        constant.
  - [ ] **Storing** — where an app exceeds this device's storage budget, **app
        entry is disabled.** The tile is shown as disabled with the reason
        stated in plain language.
  - [ ] **The guarantees below are bounded by whether the data is actually on
        this device.** Two states look similar and afford different things
        (FR-19); the product must never promise an action it cannot perform:
  - [ ] **Oversized-local** — the app's data *is* on this device but exceeds
        the storing budget. Entry is disabled, and the app **always** still
        permits export (FR-18), backup (FR-26), and remove-from-device
        (FR-33). Data already held is never held hostage.
  - [ ] **Listed-only** — the app exists in a durable home and was never
        adopted here, or was refused adoption on capacity grounds (FR-30).
        There is **no local data**, so export and backup are **not offered**
        and are not promised. Offering them would be an empty promise, and
        exporting an app that was never downloaded is impossible.
  - [ ] An **oversized-local** app offers: open on a desktop, export, reduce
        scope, or remove from this device.
  - [ ] A **listed-only** app offers: open on a desktop or larger device, or
        free space here and adopt. Its data remains safe in the durable home
        and is never at risk from this device's capacity limits.
  - [ ] An app that becomes oversized **while already stored locally** —
        through growth, or through the device's budget shrinking under storage
        pressure — becomes **oversized-local**, never listed-only. It keeps
        every guarantee of the local state, because its data is still here.
  - [ ] **Querying and charting** degrade visibly rather than disabling entry;
        anything omitted from a result or a chart is **named**.
  - [ ] Charting carries the tightest budget of the four operating budgets,
        since an aggregate is a full scan a filter change can re-trigger.
  - [ ] Where a budget is exceeded **during** a session, the app warns, leaves
        the store consistent, and never corrupts or silently drops data.
  - [ ] A sizing check precedes both import (FR-3) and adoption (FR-30), so
        the entry-disabled state is reached before a long transfer, not after.
  - [ ] Desktop routing solves **importing only**; storing, querying,
        charting, and syncing remain the phone's problem regardless of where
        the import ran.
  - [ ] **Nothing is ever silently truncated.**

---

# Non-Functional Requirements

## Performance

- **Launch:** the shell is interactive without waiting on any network, and
  without waiting on any storage provider. Unlock (FR-22) is the only gate.
- **Local-first reads and writes:** every read and write is served by the local
  store. No user-facing operation waits on a network round-trip.
- **Import:** streamed, with visible progress, and never holding a whole
  workbook in memory.
- **Recalculation:** computed columns and table metrics update on edit without
  a user-perceived stall on a mid-range phone.
- **Budgets:** the five budgets of FR-34 are measured per device rather than
  assumed. Concrete floor figures are deliberately left for Architect to set
  against a named reference device, because a number invented here would be
  guessed rather than measured. What is fixed here is the **shape**: adaptive,
  separately stated, visibly degrading, entry-gating on storage, and never
  silently truncating.

## Security

- **At rest, on device:** all user data encrypted, behind a passphrase entered
  at cold launch (FR-22).
- **At rest, in a durable home:** all user data encrypted under a
  passphrase-derived key before leaving the device (FR-27). Neither we nor the
  storage provider can read it.
- **In transit:** only ciphertext of user data is ever transmitted, and only
  between the device and the user's own storage provider. Authentication and
  storage-protocol requests are permitted and carry no workbook content (see
  *Privacy*).
- **Key handling:** two layers — vault key and per-app keys — with per-app keys
  wrapped in the vault (FR-24). No public-key infrastructure, no pairing, no
  device-to-device transfer.
- **Recoverability:** two recovery codes, each scoped to what it recovers — the
  **local** code to this device's store, a **vault** code to one durable home's
  apps (FR-23). Losing a passphrase *and* its matching code makes that thing
  unrecoverable by anyone, including us, and this is stated up front.
- **Scratch-only users are recoverable too:** the local code is issued at
  initial setup, so it exists before any durable home does.
- **Isolation:** one storage account can never enumerate another's (FR-21).
- **No secrets in the product:** no API keys, no client secrets, no
  credentials of any kind in the deployed artefact or the repository.
- **Deliberate plaintext:** exports only, stated at the moment of export.

## Accessibility

- Every interactive target meets a thumb-reachable minimum touch size on a
  phone.
- Colour is never the sole carrier of meaning — this binds theming (FR-17),
  conflict flags (FR-32), scratch badges (FR-25), and disabled tiles (FR-34).
- All themes, in both light and dark, meet standard contrast minimums for text
  and for meaningful non-text indicators.
- The product is navigable and operable by screen reader, including the review
  screen (FR-8) and the Resolve Conflicts surface (FR-32).
- Type scales with the platform's text-size setting without loss of function.
- Every state that carries meaning — scratch, stale backup, pending conflict,
  broken reference, inert content, disabled entry — has a text equivalent.

## Platform

- **Phone first, tablet second, desktop last** — phone is the design
  constraint, not the smallest breakpoint.
- Installable to the device home screen; fully functional offline (FR-20).
- Tablet landscape earns the split view — list left, detail right.
- Desktop earns the dense table and multi-pane layout, built last, from the
  same components.
- Desktop additionally serves as the import-handoff target for oversized
  workbooks (FR-10).
- Supported browsers are Architect's call, bounded by the capabilities these
  requirements demand: local persistent storage, background/service-worker
  execution for install and offline, client-side cryptography, and file
  read/write.

## Privacy

- **No telemetry on user data.** Nothing about the contents of a workbook is
  measured, transmitted to us, or retained by us (NG). There is no server of
  ours for it to reach.
- **Of the user's data, exactly two things ever leave the device**, and both
  are user-directed:
  1. **Ciphertext** the user sent to their own durable home (FR-27) — encrypted
     before it leaves, unreadable by us and by the storage provider.
  2. **Files the user explicitly exported** (FR-18) — plaintext by design,
     written where the user asked, and announced as unencrypted at the moment
     of export.
- **No user data leaves the device by any other route, for any reason.**
- **Authentication and storage-protocol traffic is separately permitted**, and
  is not user data. This covers the requests the product cannot work without:
  provider authorisation and token refresh (Constraints: public OAuth client
  with PKCE), and the requests that enumerate, size, read, and write files in
  the user's durable home (FR-26, FR-27, FR-30). This traffic:
  - is addressed **only to the user's chosen storage provider**;
  - carries **no plaintext workbook content** — no cell values, table names, or
    column names;
  - exists **only** to move ciphertext the user directed, or to find out what
    is there to move.
- **Nothing is transmitted to any party other than the user's chosen storage
  provider.** There is no other recipient, because there is no server of ours
  and no analytics endpoint.
- No analytics of any kind, and in particular none that could carry workbook
  contents, table names, or column names.

  > The idea's phrasing — *"nothing ... transmitted ... off-device"* — is
  > correct in spirit and imprecise as an acceptance criterion. Encrypted
  > backup transmits off-device by design, and so do the OAuth and discovery
  > requests that make a durable home work at all. Scoping the promise to
  > **user data**, and permitting protocol traffic explicitly, is what that
  > promise actually means and is what a build session can test against.

---

# Constraints

- **No backend, ever.** The site is a static deploy from a public repository.
  Nothing we run, nothing we pay for, nothing that can go down or be sold.
- **No secrets, no API keys, no paid infrastructure.** Provider integration
  uses public OAuth client identifiers with PKCE and app-folder-scoped
  permissions, held in build-time configuration a fork can supply for itself.
- **The OAuth client must be published to production status from the outset**,
  because refresh tokens issued by an app in testing status expire in days.
- **Storage belongs to the user**, in their account, never ours.
- **The local store is authoritative** for every read and write.
- **A provider must pass exactly two tests** — *discovery* (a second device
  authorised as the same account can enumerate what the first wrote, under a
  scope narrow enough to avoid a verification regime and without hiding the
  user's own files from them) and *isolation* (structurally impossible for one
  account to enumerate another's). There is deliberately no third test, because
  there is no sharing.
- **Google Drive is provisional.** It is expected to pass discovery under
  per-file scope but is **unverified until the architecture phase**. If it
  fails, it is dropped outright — never rescued by widening scope, and never by
  burying the user's data where they cannot see it.
- **iCloud Drive is excluded as a durable home**, because Apple offers no
  third-party web API for it. It remains an upload source.
- **Tech-agnostic until Architect.** No stack, framework, storage engine, or
  library is chosen by this document.

---

# Dependencies

- **Storage providers** for durable homes: Dropbox and OneDrive (both pass
  discovery and isolation by construction via application folders); Google
  Drive **provisional, pending architecture-phase verification**.
- **Provider OAuth endpoints**, used with public client identifiers and PKCE.
- **Platform capabilities** the requirements assume: persistent local storage,
  installability and offline execution, client-side cryptography, file read
  and write, native date input, telephone and maps handoff, and platform text
  sizing.
- **No runtime service of ours** — nothing we host, operate, or pay for, and
  nothing that can go down or be sold out from under a user.
- **The only third-party runtime services are the user's own storage provider
  and its authorisation endpoints**, listed above. They are reached on the
  user's behalf, with the user's own credentials, carrying only ciphertext —
  and a user with no durable home never contacts them at all. Any *other*
  third-party runtime service is excluded.

---

# Assumptions

- The builder's user profile is empty, so no stack preference is assumed and
  none is encoded here.
- Users have a workbook already; the workbook is the qualifier, not the
  industry.
- Users are not developers and will not author a schema, a query, or a
  formula in a new language.
- Users' workbooks already carry structure — headers, filled-down formulas,
  cross-sheet lookups, totals rows — built up over time.
- Multiple devices means **one person's devices**, always.
- A user who reaches the durable-home reminder repeatedly and keeps dismissing
  it has made an informed choice; the product's obligation is to keep saying
  so, visibly and permanently, not to prevent them.
- Local storage on a device is **not** a durable guarantee: it can be reclaimed
  under storage pressure, after long disuse, or on app deletion, and the rules
  differ by platform and change between releases.
- A mid-range phone, not a flagship, is the performance reference.
- Providers' application-folder scopes remain available on the terms assumed
  here.

---

# Glossary

- **Sheaf** — the product. A sheaf is a bundle of sheets bound together, which
  is both what a workbook is and what the app library is.
- **Shell** — the library home screen listing every generated app as a tile.
- **Generated app** — a self-contained, independently themed application
  produced from one workbook, with its own data store, schema, theme, and
  charts.
- **Durable home** — the permanent location for an app's encrypted store: a
  folder in the user's own Google Drive, Dropbox, or OneDrive, or an encrypted
  bundle file the user saves themselves.
- **Scratch app** — an app with no durable home. Fully usable, permanently
  badged as not backed up.
- **Bundle file** — an encrypted single-file durable home the user saves
  manually. Cannot be enumerated, cannot be written automatically, goes stale
  the moment a record changes.
- **Vault** — the encrypted index of apps for **one durable home**, holding
  each app's key wrapped. What lets a device with only a passphrase discover
  what exists. A cloud home has one; a bundle file *is* one. A scratch app has
  none.
- **Vault key** — derived from the passphrase; unlocks the vault.
- **App key** — per-app encryption key, wrapped inside the vault. Exists for
  blast-radius containment, never for sharing.
- **Local unlock passphrase** — the secret entered at cold launch that decrypts
  the on-device store. Offered as the same secret as the vault passphrase on
  first run.
- **Local recovery code** — a written code issued at **initial setup**, when
  the local unlock passphrase is created. Unlocks **this device's store**
  without data loss. Exists for every user, including one who never creates a
  durable home.
- **Vault recovery code** — a written code issued at **vault creation**, one
  per durable home. Opens **that home's vault on any device** so its apps can
  be adopted. Does not unlock any device's local store.
- **Reset** — the destructive path taken when a passphrase and its recovery
  code are both lost. Wipes the local store; leaves durable-home ciphertext
  intact. What survives is each app's **last successful backup** — not its
  current state, and not its device-only changes.
- **Deletion marker** — the explicit record written to a durable home by
  *delete everywhere*. Distinguishes a deleted app from one a device has simply
  not synced yet, and is retained long enough for a long-offline device to find
  it. Not an undo.
- **Adoption** — acquiring an app that already exists in a durable home.
  Distinct from import: nothing is re-parsed, re-inferred, or re-reviewed.
- **Import** — producing a new app from a workbook file, ending in the review
  screen.
- **Review screen** — the single plain-language confirmation shown at the end
  of import. Never shown for adoption.
- **Change log** — the append-only record of changes, compacted periodically,
  that makes deltas and reconciliation possible.
- **Compaction** — periodic collapse of the change log, which never discards
  what reconciliation still requires — including baselines.
- **Baseline** — a row's value as of the last point two copies are known to
  have agreed: the last import for a re-uploaded workbook, the last successful
  reconciliation for a second device. Without it, "one side changed" and "both
  sides changed" are indistinguishable.
- **Baseline-absent** — a row whose baseline is unavailable. Reconciliation
  falls back to conservative behaviour: every difference goes to the user.
- **Three-way comparison** — comparing baseline, local, and incoming. The only
  comparison permitted to auto-apply a change.
- **Reconciliation** — resolving two divergent copies field by field, against a
  baseline, with the merged result validated before it is applied. One engine
  serves offline queues, multi-device sync, and workbook re-upload.
- **Identity conflict** — ambiguity about which row in a file corresponds to
  which row in an app. Always resolved by the user.
- **Conflict** — the same field changed on both sides to different values, a
  contested key change, or a delete opposed to an edit. Always resolved by the
  user.
- **Record-level conflict** — a merge that is valid field by field but produces
  an invalid record. Resolved whole, not per field.
- **Applied log** — the auditable record of changes that merged automatically,
  shown alongside pending conflicts so automatic merging is never invisible.
- **Declared table** — a table the workbook itself defines. Wins outright over
  any inference.
- **Sheet snapshot** — the read-only retained copy of every sheet, so no sheet
  is ever silently lost.
- **Budget** — one of the five separately-stated capacity limits: importing,
  storing, querying, charting, syncing.
- **Present** — an app whose data is on this device and within budget.
- **Oversized-local** — an app whose data **is** on this device but exceeds the
  storing budget. Entry is disabled; export, backup, and removal remain
  available, because the data is here.
- **Listed-only** — an app that exists in a durable home but has **no local
  data** here: never adopted, or refused adoption on capacity grounds. Cannot
  be exported or backed up from this device, because there is nothing here to
  export. Not the same as *oversized-local*, and never labelled merely
  "disabled".
- **Device-only changes** — changes recorded locally that no successful backup
  has yet captured. The quantity that makes a removal destructive.
- **Import contract** — supported structures become interactive; unsupported
  content is preserved and visibly identified.

---

# Decisions Derived in This Phase

Recorded separately because they were **not** stated in `specs/idea.md` and
were **not** explicitly answered by the builder. They follow from the answers
that were given, and are flagged here so they can be redlined at the phase gate
rather than discovered later by Architect.

1. **The passphrase gates the launch, not the network.** FR-20 forbids a
   sign-in on the launch path; FR-22 requires a passphrase there. These are
   reconciled by reading the idea's objection as being to *network dependence*,
   not to a local secret. A passphrase prompt needs no connectivity.
2. **Unlock persists for the session, and the idle timeout defaults to off.**
   Aggressive re-locking would punish exactly the offline field use the product
   exists for.
3. **Passphrase *change* and passphrase *reset* are different operations.** The
   builder described the destructive case. A change made while the current
   passphrase is known can re-wrap keys losing nothing, and it would be wrong
   to force a wipe for it.
4. **Reset does not delete durable-home ciphertext.** Wiping the device is
   recoverable if the remote copy survives; deleting both forecloses a recovery
   the user might still reach. Destroying the remote copy is kept as a separate
   confirmed action.
5. **Two secrets are possible, one is offered.** One vault per durable home
   (Q6) plus a launch passphrase (Q4) could mean several secrets. FR-24
   resolves this by offering the same passphrase for both on first run, and by
   prompting for a second home's vault passphrase only once, at connect time.
   *The alternative — enforcing one passphrase across every vault a user owns —
   is simpler but fails when a vault was created elsewhere with a different
   one.*
6. **Capacity is two-tiered.** The builder's entry-disable (Q10) is applied to
   the **storing** budget; the idea's visible degradation is retained for
   **querying** and **charting**. Applying entry-disable to all five would make
   a single expensive chart lock a user out of their data.
7. **A disabled app still exports — if its data is here.** Not stated by
   anyone, but the alternative is holding a user's data hostage behind a
   capacity limit, which contradicts the product's entire premise. Bounded by
   derived decision 15 below.
8. **Performance floors are deferred to Architect**, against a named reference
   device. Inventing numbers here would be guessing; the *shape* of the budgets
   is fixed above and is what Architect must satisfy.
9. **"Cloud home" is read as "durable home."** The builder's Q7 answer said
   *cloud home*; `idea.md` admits a saved bundle file as an equally valid
   durable home. The reminder is therefore for a durable home of either kind.

## Added in the first review pass

Derived while resolving builder review findings on the initial draft. Same
status as the above: inferred, and open to redline.

10. **The locked reset confirmation is deliberately uninformative.** It cannot
    name what it destroys, because naming it would require either decrypting
    the store or keeping a plaintext inventory beside it — and the second would
    defeat FR-22 to improve a dialog. The confirmation says so, and treats its
    own ignorance as evidence the encryption works.
11. **Removal is destructive whenever device-only changes exist**, not only for
    scratch apps. "Reversible" was previously claimed on the strength of a
    durable home existing; what re-adoption actually restores is the last
    *successful backup*. The gap between those two is the user's unbacked-up
    work, and it can be weeks wide.
12. **A baseline is retained per row, and compaction may not discard one still
    in play.** This is a real storage cost, paid because the alternative is a
    two-way comparison that cannot distinguish a user's edit from a stale
    file's value. *Architect and DB should size this deliberately — it is the
    most expensive requirement added in this pass.*
13. **A missing baseline degrades into more questions, never a silent guess.**
    Conservative fallback means a re-upload against an app with no baseline may
    ask about a great many rows. That is the correct failure direction, and it
    is a real usability cost worth knowing about now.
14. **Record-level validation is now a product capability**, not only a merge
    check. The merge cannot reject an invalid combination unless the app can
    express what "invalid" means, so cross-field rules are inferred, editable,
    and applied on both the input path and the merge path. *This is the largest
    functional addition of this pass and is the one most worth challenging.*
15. **`listed-only` and `oversized-local` are distinct states.** An app refused
    at adoption has no local data, so export and backup are impossible and are
    therefore not offered. Collapsing the two states would make the product
    promise an action it cannot perform.
16. **Durability may not depend on a termination event.** Mobile platforms
    terminate backgrounded applications without a reliable close event, so
    "backup on close" was unimplementable as written. Replaced with durable
    local recording on every acknowledged write, best-effort backup on
    backgrounding, and retry on resume — with backup status advancing only on
    confirmed completion.
17. **The privacy claim is enumerated rather than absolute.** `idea.md` says
    nothing is transmitted off-device; encrypted backup plainly transmits
    off-device. The requirement now names the two things that ever leave —
    user-directed ciphertext and user-requested exports — which is testable
    where the absolute phrasing was not. *This sharpens the idea's wording
    without changing its intent; worth confirming that reading.*

## Added in the second review pass

18. **Reset survives to the last backup, not to the app.** "Has a durable home"
    was being read as "is safe." It is not — it is the same gap FR-33 already
    closed for removal, and reset had the identical defect. Device-only changes
    die in a reset, and the locked confirmation cannot say how many, because
    that count is itself encrypted.
19. **Two recovery codes, because there are two things to recover.** A local
    code issued at initial setup (this device's store) and a vault code per
    durable home (that home's apps, on any device). The previous single
    vault-created code left a scratch-only user with an unlock screen offering
    a recovery path that had never been generated. They are issued separately
    even when one passphrase covers both, and every prompt names which secret
    it is asking for. *This is the correction with the most surface area — it
    touches setup, unlock, reset, and the design of every passphrase prompt.*
20. **Privacy is scoped to user data; protocol traffic is permitted
    explicitly.** The absolute phrasing outlawed the OAuth, refresh, and
    discovery requests the document requires elsewhere — a rule the product
    would have violated on its first successful backup. Protocol traffic is now
    permitted by name, bounded to the user's chosen provider, and required to
    carry no plaintext workbook content. The Dependencies contradiction
    (`no third-party runtime service of any kind`) is corrected on the same
    terms.
21. **Delete-everywhere is not a remote wipe, and says so.** Deletion is
    recorded as a retained marker rather than a bare file removal, because an
    absent app and an unsynced app are indistinguishable to a device that has
    been offline. A reconnecting device may neither silently resurrect the app
    nor silently discard what it holds: with device-only changes it offers
    export or bundle first and requires acknowledgement; with none it removes
    the local copy and says why. *Marker retention is a real obligation on the
    durable home — Architect should decide how long "long enough" is.*
