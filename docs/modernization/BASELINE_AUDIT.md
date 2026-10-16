# 20Negar Modernization Baseline Audit

Date: 2026-10-16
Branch: `main`
Commit: `317cf25` (`some bugfixes`)

## Scope and current state

The repository is a React 19 + TypeScript frontend built with Vite and an Express 4/`tsx` modular monolith. SQL.js provides an in-memory SQLite database persisted to `data/cineflow.sqlite`. Media is stored below `data/storage`; FFmpeg processing runs in an in-process polling worker. An optional Rust transfer service exists at `rust/negartransfer`.

The working tree contains untracked OmniRush workspace metadata (`.opencode/`, `opencode.jsonc`) supplied by the environment. No tracked application files were modified before this audit.

## Existing entry points and checks

| Area | Evidence |
| --- | --- |
| Server | `server.ts`, Express routes under `server/routes/` |
| Frontend | `src/main.tsx`, `src/App.tsx` |
| Database | `server/db/database.ts`, `server/db/schema.ts` |
| Auth | `server/routes/auth.routes.ts`, `server/middleware/auth.middleware.ts`, JWT bearer tokens |
| Uploads | Multer direct upload, custom chunk upload, TUS, and optional Rust transfer paths |
| Downloads | `server/routes/video.routes.ts`, optional Rust streaming proxy |
| Processing | `server/services/transcoder.service.ts`, FFmpeg/FFprobe subprocesses |
| Static checks | `npm run lint` (`tsc --noEmit`) |
| Frontend build | `npm run build` |
| Rust build | `npm run build:transfer` |
| Automated tests | `npm test` runs the focused Node test suite in `tests/` |

## Data and workflow findings

The schema is video-centric. It has users, videos, versions, qualities, reviews, audit logs, notifications, and processing jobs, but no first-class projects, categories, project membership, upload sessions, checksums, publication destinations, assignment records, or versioned migration table. The current workflow is effectively `Uploaded/Processing -> PendingReview -> Approved/Rejected`; approval is not yet a formal immutable-revision state machine.

The repository currently has four active upload mechanisms with different session and authorization models. Chunk and TUS state are filesystem metadata rather than durable domain records. Upload completion checks size/chunk presence but does not persist or verify a SHA-256 checksum.

## Priority defects confirmed by inspection

1. HLS `.ts` segment requests bypass authentication and the normal video access check; HLS path containment is also incomplete (`server/routes/video.routes.ts`).
2. `LocalFileStorage` sanitizes only leading traversal and does not enforce resolved-path containment (`server/storage/local.storage.ts`).
3. An `Admin` can create a `SuperAdmin` because the create-user route accepts every role (`server/routes/user.routes.ts`).
4. Existing JWT claims are trusted without re-checking current user activity or role, so deactivation/demotion waits for token expiry (`server/middleware/auth.middleware.ts`, `server/services/auth.service.ts`).
5. Approval/rejection does not require the pending-review/ready state and can leave contradictory approval and rejection fields (`server/services/video.service.ts`).
6. Range parsing does not reject malformed ranges or clamp an end offset (`server/routes/video.routes.ts`).
7. SQL.js persistence is debounced and directly overwrites the database file; no versioned migration/recovery procedure is present (`server/db/database.ts`, `server/db/schema.ts`).

## Baseline implementation plan

### Slice 1: authorization and media safety (this change)

- Enforce HLS authentication and HLS-root containment.
- Enforce storage-root containment in the storage abstraction.
- Prevent Admin-created SuperAdmin accounts.
- Revalidate active user and current role when authenticating a request.
- Reject invalid download ranges and keep approval transitions internally consistent.
- Add focused regression tests for storage containment.

## Executed baseline and phase checks

Environment: Windows, Node.js `v24.21.0`, npm `11.19.0`.

| Command | Result |
| --- | --- |
| `npm install` | Completed; 453 packages installed. npm reported existing deprecation warnings. |
| `npm test` | PASS — 5 tests passed, including storage containment and checksum/idempotency tests. |
| `npm run lint` | PASS — `tsc --noEmit` completed successfully. |
| `npm run build` | PASS — Vite production build completed successfully. |
| `cargo check --manifest-path rust/negartransfer/Cargo.toml` | PASS — Rust transfer crate checked successfully. |
| `npm run build:transfer` | BLOCKED — the tool process ended with `ChildProcess.kill`; `cargo check` is the verified Rust result instead. |

No production database, storage directory, deployment target, or external network endpoint was used.

### Slice 2: authoritative upload integrity

- Add versioned migrations and a durable `upload_sessions` table.
- Select one canonical resumable protocol and document compatibility/deprecation for the others.
- Persist expected/actual size, checksum, ownership, expiry, and finalization state.
- Verify SHA-256 before finalization and make finalization idempotent and recoverable.

### Slice 3: workflow and organization model

- Add projects, categories, memberships, publication destinations, assignments, and immutable deliverable revisions.
- Centralize policies and add server-side authorization tests for every transition.

### Slice 4: operations and performance

- Add database backup/restore runbooks, worker recovery, quotas, health diagnostics, deployment guidance, and measured transfer benchmarks.

## Risks and deliberate deferrals

The current application has no test harness, production deployment definition, or confirmed runtime credentials/services. This audit therefore records static evidence only; no production migration, large-file benchmark, or external-network Internal App verification is claimed. The upload-session redesign is intentionally deferred until the existing TUS, custom chunk, and Rust paths can be tested against one contract without silently breaking current users.
