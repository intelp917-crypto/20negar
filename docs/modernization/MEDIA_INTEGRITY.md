# Media integrity and project placement

## Original video bytes

The original upload is not transcoded, recompressed, resized, normalized, or
metadata-edited. The browser's primary upload path uses TUS with fixed-size
chunks and resumable offsets. The server reconstructs the original byte stream,
calculates a streaming SHA-256 before completion, and stores the original under
private storage. FFmpeg runs only after asset creation to produce separate
thumbnails, MP4 renditions, and HLS derivatives.

Downloads use the immutable original path when `quality=Original` (the default).
Quality selections are explicitly derived files and never replace the original.
HTTP Range responses stream byte ranges from the selected immutable file; they
do not reduce video quality. The Rust transfer path remains available for
legacy/operational compatibility but is no longer selected by the browser as an
unrelated upload fallback.

## Project placement at upload time

The upload dialog requires one of:

- an existing project visible to the authenticated uploader; or
- a new project name, which is created server-side before the uploaded file is
  moved out of temporary storage.

The resulting `videos.project_id` relationship is stored in the database. A
revised upload inherits its parent video's project. Unauthorized project IDs,
missing selection, and invalid new-project data are rejected before final file
placement.

Chunking is a transport detail only. It does not imply compression or quality
loss, and the server treats upload completion and workflow approval as separate
operations.
