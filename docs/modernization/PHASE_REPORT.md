# Modernization Phase Report

Date: 2026-10-16
Branch: `feature/enterprise-media-workflow`

## Completed phases

### Phase 1 — Stabilization and media safety

Implemented and committed as `35b9298` (`feat: harden media authorization and upload integrity`).

- HLS requests require authentication and remain within their video HLS root.
- Storage keys enforce resolved-root containment.
- Current user state is reloaded during authentication.
- Admins cannot create SuperAdmins.
- Review state and HTTP Range validation are enforced server-side.
- SHA-256 verification is available on the compatibility chunk endpoint.

### Phase 2 — Persistence and upload-session foundation

Implemented and committed as `c893dc3` (`feat: add durable upload session foundation`).

- Added repeatable `schema_migrations` tracking.
- Added additive `upload_sessions` schema and typed service helpers.
- New custom chunk sessions are mirrored into durable upload-session records.
- Database persistence uses a flushed temporary file, atomic replacement, and `.bak` recovery copy.
- Added isolated persistence, migration, upload validation, checksum, and idempotency tests.

### Phase 3 — Centralized legacy workflow policy

Implemented and committed as `f06e847` (`refactor: centralize review authorization policy`).

- Added a policy module for role creation and review eligibility.
- Review methods use the policy for assignment, ready-state, and self-review checks.
- Added pure authorization-policy tests.

## Actual verification

Environment: Windows, Node.js `v24.21.0`, npm `11.19.0`.

- `npm test` — PASS, 17 tests passed.
- `npm run lint` — PASS, TypeScript completed with no errors.
- `npm run build` — PASS, Vite production build completed.
- `cargo check --manifest-path rust/negartransfer/Cargo.toml` — PASS.
- `git diff --check` — PASS for the reviewed changes.
- `npm run build:transfer` — BLOCKED/ambiguous: the command ended with `ChildProcess.kill`; `cargo check` is the verified Rust result instead.

## Remaining blockers and risks

- The TUS path now records ownership, checksum, and lifecycle state in `upload_sessions`, but still converts into the legacy sidecar session for the existing video-creation contract.
- The Rust fast path and custom chunk path remain available for compatibility; a tested deprecation or common-session adapter is still required.
- The durable upload service is used by both the custom chunk compatibility path and TUS lifecycle callbacks; a single finalization authority and API-level TUS integration tests remain.
- Project, membership, category, destination, and assignment foundations exist; immutable revision identity and full publication workflow remain.
- Internal App configuration and verified health/switching foundations exist; real LAN/certificate/browser-origin scenarios remain untested.
- No external-LAN benchmark, production deployment, backup restoration against organizational data, or large-file transfer benchmark was executed.
- Query-string bearer tokens remain supported for browser media elements and remain a documented security risk until scoped short-lived media URLs exist.

### Phase 4 — Project and verified Internal App foundations

Implemented in the current working phase:

- Added additive project, membership, logical category, destination, and publication-assignment tables.
- Added project listing, access-controlled lookup, creation, and membership APIs at `/api/projects`.
- Added SuperAdmin-configured Internal App settings at `/api/internal-access`.
- Added HTTPS/private-host validation, server-side health verification, user-facing Internal App navigation, and SuperAdmin configuration UI.

Verification for this phase: `npm test` passed 17 tests, `npm run lint` passed,
`npm run build` passed, and `git diff --check` passed.

## Next dependency-ordered phase

Complete the TUS/database integration without breaking existing sidecar sessions: create and update the durable session at TUS create/offset/finalize events, return the authoritative application session ID, make finalization idempotent, and add API-level tests for ownership, resume, checksum mismatch, and restart recovery. Only after that should project/revision/publication entities be built on the durable upload boundary.
