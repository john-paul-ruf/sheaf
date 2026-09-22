# M58 — Workbook fixtures (`tests/fixtures/workbooks/`)

> Fragment created by Roshi at the F02 final pass. The content below landed
> during F02 (SESSION-03, `98925cc`) and had been stapled inside
> `M19-delimited.md`, which is a different module; it is stated here instead.
> Reconciled against the tree at `5ab3b07`.

## Contract

- **Owns:** The fidelity + refusal corpus per import format.
- **Corpus owner rule:** the fixture corpus belongs to **one** session's lease
  and is unreachable to every later one. A later session either plans its
  fixtures inside its own lease or names this corpus's owner as a supplier.
  F02's S04 hit exactly this and built synthetic in-page fixtures for its volume
  cases instead (truthful, but a workaround a lease boundary forced).

## Byte fidelity (`.gitattributes`)

`tests/fixtures/workbooks/.gitattributes` sets `* -text`. **A fixture's bytes
are the test subject.** This repository's `core.autocrlf=input` had silently
rewritten the CRLF fixtures on their way into the index, so a fresh clone would
have disagreed with the tree they were authored in. Every later fixture author
inherits this attribute; adding a fixture directory outside this path re-opens
the hazard.

## F02 corpus

Delimited fidelity + refusal fixtures for M13 sniffing, M14 refusal routing,
M19 parsing and M21 inference, including the pinned demo file
`field-log-messy.csv` behind the GATE-F02 demo script, an NFD crew fixture for
D28, and ragged/quoting/encoding cases. Workbook-format fixtures exist only as
refusal subjects in F02; their fidelity corpora arrive with F03's adapters.

## Change History

- 2026-09-08 — corpus created by SESSION-03 (`ad0871e`); `.gitattributes`
  correction at `98925cc`.
- 2026-09-08 — fragment created by Roshi (F02 final pass) so the fixture-byte
  contract lives with its own module rather than inside M19's.
