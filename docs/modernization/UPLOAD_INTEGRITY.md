# Custom chunked upload integrity

The existing `POST /api/chunked-uploads` protocol remains compatible with clients
that do not provide a checksum. Clients may provide a SHA-256 value in the create
request as `checksum`, `expectedChecksum`, or `sha256` (the
`X-Upload-Checksum` header is also accepted).

When `/api/chunked-uploads/:id/complete` is called, the server hashes the assembled
file before returning success. Session metadata stores `expectedChecksum`,
`actualChecksum`, `verifiedAt`, `verificationResult`, and `finalizedAt`. A mismatch
is rejected with HTTP 400 and the recorded result is retained. A successful or
checksum-unavailable completion can be repeated safely; it returns the persisted
completion result without hashing or rewriting it again. Chunks are rejected after
finalization.

Metadata writes use a flushed temporary file followed by a rename, so a process
interruption cannot leave a partially-written JSON document at the session path.

## Durable foundation

New custom chunk sessions are also recorded in the additive `upload_sessions`
database table through `server/services/upload.service.ts`. The database record
stores ownership, expected/actual size, storage keys, lifecycle state, expiry,
checksum verification, and safe failure details. The sidecar JSON remains the
transport compatibility record during this incremental migration; it is not yet
the canonical TUS finalization implementation.

Database exports now use a same-directory temporary file, `fsync`, atomic rename,
and a `.bak` copy of the previous valid database file. This protects the last
persisted file from a partial direct overwrite, but it is not a substitute for a
verified backup/restore procedure.
