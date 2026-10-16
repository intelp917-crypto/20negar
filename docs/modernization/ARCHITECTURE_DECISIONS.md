# Architecture Decisions

Date: 2026-10-16

## ADR-001: Retain the modular monolith for the first modernization phases

The application remains an Express + React modular monolith. The current workload is approximately ten concurrent users, and no measured requirement justifies introducing a broker, service mesh, or separate media service. Boundaries will be strengthened through services and policy modules before considering process separation.

## ADR-002: Preserve original bytes and store derived media separately

Uploaded originals remain unchanged. FFmpeg thumbnails, renditions, and HLS outputs are derived files. Approval must never be inferred from upload completion or processing completion.

## ADR-003: Prefer TUS as the canonical resumable transport

The repository already contains a standards-based TUS implementation. The custom chunk and Rust paths are compatibility concerns, not independent workflow authorities. The next upload phase will map transport state to one application-owned session/finalization model and will not silently create a second session on fallback.

## ADR-004: Introduce integrity verification incrementally

The existing custom chunk endpoint now accepts an optional SHA-256 and verifies the completed bytes server-side. This is a compatibility bridge, not the final durable upload architecture. The next phase will persist upload sessions in the database and require the canonical path to record checksum and finalization state.

## ADR-005: Keep SQL.js until a safe migration is proven

The current SQL.js database is process-local and has persistence risks. Native SQLite remains an option, but replacing the engine without a verified backup, migration, restore test, and compatibility plan would be riskier than first adding versioned migrations and atomic persistence. No production database engine change is performed in this phase.

## ADR-006: Server-side policy is authoritative

Frontend role filtering is only presentation. Authentication reloads current user state, protected media routes authorize every request, and workflow methods validate source state and actor assignment on the server. Query-string bearer tokens remain a documented compatibility risk for browser media elements until scoped short-lived media URLs are implemented.
