# Internal App access

SuperAdmins configure the feature from the system telemetry panel under
**Network and Internal Access**. The server accepts only HTTPS URLs with a
private IP address or an internal DNS name (`.local`, `.lan`, `.internal`, or a
single-label host). Credentials, query strings, fragments, and unsafe paths are
rejected.

The configuration is stored in the `app_settings` table. Ordinary authenticated
users can read the enabled internal endpoint and instructions, but only a
SuperAdmin can modify settings or run the server-side health verification.

Health verification requests `${configured-url}/api/health` and requires the
minimal service identity `20Negar Studio API`. It records only `healthy` or
`unavailable` status and the last successful check timestamp. It does not expose
filesystem paths, environment variables, database credentials, or transfer
diagnostics.

The Navbar's **برنامه داخلی** button performs a browser-side reachability and
service-identity check before navigation. A failed check leaves the public app
active. Since different origins have separate browser storage and cookie rules,
users may need to authenticate again after navigation; the application does not
copy bearer tokens to the internal origin.

This feature does not claim LAN performance improvement. Internal/external
throughput must be benchmarked separately under real network conditions.
