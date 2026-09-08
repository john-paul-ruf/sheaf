# ROADMAP — Sheaf

> **Owner:** Forge (structure) + Human (gate verdicts). Jikijitsu halts at gates.
> **Created:** 2026-09-08. Living document — each gate verdict is recorded here.
> **Sources:** specs/requirements.md (FR-1–34), specs/design.md (12 approved
> user flows), specs/architecture.md, FORGE-CONFIG.md.

One program, eight features, seven internal demo gates plus a release gate.
Each feature is a separate Forge run producing `prompts/{F_NAME}/`. A feature
ends in a **demoable build** and a **gate**: the human runs the demo script,
gives feedback, and only an approval rolls the program into the next feature.

## Gate Protocol

1. **A feature's last session leaves the app demoable** — buildable, servable
   locally, demo script executable on the committed revision. Demo readiness is
   folded into the final capability sessions (never a verification-only session).
2. **Jikijitsu stops at the gate.** The feature's STATE.md carries a standing
   human blocker `GATE-F0N` (class: product-design decision). No next-feature
   session is dispatched, and no next-feature Forge planning starts, until the
   verdict lands — so feedback reaches the next plan's Step 1 inputs, not a
   replan.
3. **Demo mechanics:** build the gate revision (`pnpm build`), serve `dist/`
   locally, record the served commit hash with the verdict. Dev-server demos
   are allowed for interaction feedback but the gate verdict is on the built
   artifact.
4. **Verdicts:**
   - **approve** — roll into the next feature.
   - **approve-with-notes** — roll forward; notes become Step 1 inputs of the
     next Forge run (mechanical/cosmetic only).
   - **revise** — correction sessions appended to the *current* feature;
     re-demo the same gate.
   - **redirect** — feedback changes product behavior, design, requirements,
     or schema → route through Genesis re-entry (design-change → Designer,
     requirements-change → Spec, schema-change → DB), then Forge re-cuts the
     affected roadmap entries before anything rolls forward.
5. **Truthful scope at every gate.** Each demo names what is intentionally
   absent and which feature completes it. Interim states fail closed through
   approved surfaces (e.g., a format not yet implemented routes to the approved
   refusal surface); no fabricated success, no invented copy.
6. **Gate record:** append date, revision, verdict, feedback disposition to the
   Gate Log below.

---

## Feature Sequence

### F01 — `foundation-first-unlock`
- **Theme:** The encrypted spine and the security column, end to end.
- **Builds:** Toolchain scaffold (pnpm/Vite/Vitest/Playwright/strict TS),
  theme tokens + base layer (from mock token system, Tailwind CDN dropped),
  worker RPC (M32/M33), crypto hierarchy (M08), codecs (M09), envelope store
  over existing migrations (M11), bootstrap + capability checks (M53),
  routes/entry (M54/M55), security surfaces SCR-001–009: welcome, protect
  device, local recovery code, unlock, passphrase change, local recovery,
  three-stage local reset.
- **Covers:** FR-19 (shell skeleton), FR-22, FR-23 (local legs), NFR security
  floor. Flow 12, local half.
- **Demo script (GATE-F01):** fresh profile → capability check → protect this
  device → record recovery code → lock → unlock (wrong passphrase → escalating
  delay) → passphrase change → recover via code → reset → **close browser,
  reopen: state survives encrypted; devtools shows ciphertext only.**
- **Absent by design:** import, apps, providers. Library is the approved empty
  state.
- **Est. sessions:** 5–7.

### F02 — `csv-import-first-app`
- **Theme:** The ten-second proof on the thinnest format: file → app.
- **Builds:** Domain model/validation core (M01/M02), import source +
  preflight core (M13/M14), delimited adapter (M19), inference subset for
  value-only facts (M21 partial), review surface, staging/atomic promotion
  (M23), projection hydration (M12), commands/queries/view-models core
  (M34/M35/M37), library tiles (M42), records surfaces: app home, table,
  record detail/create/edit (M44), basic per-app identity.
- **Covers:** FR-1/FR-2 (delimited + refusal surface), FR-4/FR-6 (subset),
  FR-8, FR-9, FR-11/FR-12 (core CRUD + validation), FR-17 (partial). Flow 1 on
  CSV; flow 3 basic.
- **Demo script (GATE-F02):** unlock → upload messy CSV → pre-flight → review
  proposal (rename column, fix a type) → Create app → app home → search → open
  record → typed edit with validation → save → **reload: durable** → upload an
  .xlsx → approved refusal surface (truthful: workbook formats land in F03).
- **Est. sessions:** 6–8.

### F03 — `workbook-fidelity`
- **Theme:** Real spreadsheets, safely: every accepted format, every refusal.
- **Builds:** OOXML/XLSB/BIFF/ODS/html-table adapters (M15–M18, M20), macro
  and container-bomb refusal, full pre-flight sizing + sheet selection, sheet
  snapshots + inert-content inventory (M22), full inference: regions, enums,
  keys, relationships, remembered rejections (M21), import UI completion
  (M43), desktop-handoff instruction surface, workbook fixture corpus (M58).
- **Covers:** FR-1–FR-10 complete (FR-10 instruction leg; adoption leg in
  F06), FR-5, FR-7. Flow 1 full.
- **Demo script (GATE-F03):** import a multi-sheet .xlsx with relationships,
  formats, validations → sheet selection → review evidence ledger → reject a
  proposed relationship → create → navigate related records → view snapshot of
  a non-tabular sheet → macro workbook → whole-import refusal → oversized
  workbook → desktop-handoff instructions. Formulas/charts appear preserved
  with provenance (live in F04).
- **Est. sessions:** 6–8.

### F04 — `formulas-queries-charts`
- **Theme:** The app becomes alive: computation, query, charts, schema.
- **Builds:** Formula engine (M03: parser, IR, catalog, graph, evaluator),
  query surface + FTS (M35 complete), charts + accessible table/summary
  alternative (M45), chart builder, schema/rule/formula/theme editors (M46),
  per-app theming (M40 complete).
- **Covers:** FR-13–FR-17 complete. Flow 2.
- **Demo script (GATE-F04):** open imported app → formulas recalc live on
  edit → filter + sort + relationship traversal → open imported chart → tap a
  mark → filtered records → build a new chart → pin it → edit schema (add
  column with rule) → change app theme → contrast holds.
- **Est. sessions:** 5–7.

### F05 — `durable-home-backup`
- **Theme:** Data outlives the device: vaults, providers, backup truth.
- **Builds:** Sync protocol (M24), vault key layer, Dropbox + OneDrive +
  bundle adapters (M25–M27), scheduler + coordinator push path (M29/M30),
  durability UI (M47), scratch reminders + backup freshness policy (M05
  complete), provider-contract doubles (M62).
- **Covers:** FR-24–FR-28. Flows 4, 5. (Requires registered Dropbox/Microsoft
  test apps — human-supplied client IDs; bundle path demos fully offline.)
- **Demo script (GATE-F05):** edit in scratch app → non-blocking reminder →
  choose durable home → vault setup + vault recovery code → first encrypted
  backup → status shows confirmed time + zero device-only → go offline → edit
  → truthful pending status → reconnect → confirmed. Bundle: save encrypted
  bundle to Files; provider ciphertext shown opaque.
- **Est. sessions:** 6–8.

### F06 — `adoption-sync-merge`
- **Theme:** Second device, divergence, and one reconciliation engine.
- **Builds:** Reconciliation engine (M06), discovery + adoption (M28),
  coordinator pull/merge path (M30 complete), conflict surfaces + applied log
  (M48), re-upload row identity + review (M43/M21 completion), reset's
  durable-home reconnect leg.
- **Covers:** FR-29–FR-32; FR-10 adoption leg; flow 12 durable leg. Flows
  6–9.
- **Demo script (GATE-F06):** second browser profile → unlock → connect same
  home → vault secret → discover listed apps → sizing → adopt (no re-review)
  → edit both profiles offline → sync → automatic merges in applied log →
  contested field → conflict queue → per-field resolution → re-upload a newer
  workbook → row identity → reuse conflict surface.
- **Est. sessions:** 6–8.

### F07 — `ownership-capacity-export`
- **Theme:** The user can always leave, and limits tell the truth.
- **Builds:** Export worker + XLSX/CSV/PNG/PDF (M31), capacity budgets +
  probes + doors (M04 complete), oversized-local/listed-only states, removal /
  delete-everywhere / deletion-marker rescue (M49), ownership UI completion.
- **Covers:** FR-18, FR-33, FR-34. Flows 10, 11.
- **Demo script (GATE-F07):** export app to XLSX and PDF → open externally →
  capacity door on oversized fixture → named remedies → remove-from-phone
  with nonzero device-only count → blocked until backup → delete everywhere →
  second profile shows marker, offers rescue of local-only changes.
- **Est. sessions:** 4–6.

### F08 — `install-hardening-release`
- **Theme:** Installable, offline, hardened, shipped.
- **Builds:** Service worker + precache + safe update gate (M52), install
  prompts + platform adapters (M51 complete), Chromium share-target inbox,
  account isolation checks (FR-21), CSP/egress guard finalization, security
  probes (M64), performance budget runs (M63), full a11y pass (M61), Cloudflare
  Pages reference deploy.
- **Covers:** FR-20, FR-21, EXT-002 (platform-conditional), all NFR gates.
- **Demo script (GATE-F08 / release):** install on a real phone → airplane
  mode → full unlock/CRUD/chart/export offline → share a workbook into Sheaf
  (Chromium) → update banner on new deploy → migration-gated activation →
  performance/a11y/security evidence pack reviewed.
- **Est. sessions:** 4–6.

---

## Dependency Spine

F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08. Strictly serial at gates by
design — the approval *is* the scheduling edge. Inside each feature, Jikijitsu
parallelizes sessions per that feature's Wave Plan as usual. F07's export
worker and capacity work depend only on F02–F04 state and could theoretically
overlap F05/F06, but they stay serial: one demoable trunk beats two unstable
branches.

## Standing Human Inputs (known now, not gate feedback)

- **F05:** Dropbox and Microsoft app registrations (public client IDs +
  redirect URIs) — needed before F05's provider sessions dispatch; bundle
  sessions proceed without them.
- **F08:** Cloudflare Pages project + custom domain choice; real test phone.

## Gate Log

| Gate | Date | Revision | Verdict | Feedback disposition |
|------|------|----------|---------|----------------------|
| — | | | | |
