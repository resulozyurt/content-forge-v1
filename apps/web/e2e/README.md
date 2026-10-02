# Editor regression checks

Run from the repository root:

- pnpm --filter web test:unit
- pnpm --filter web test:editor
- pnpm --filter web exec tsc --noEmit

The browser suite uses system Chrome on Windows and Playwright Chromium elsewhere
(install it with pnpm --filter web exec playwright install chromium).
Port 3211 must be available. The runner copies a fixture page into app/ only for
the duration of the test, starts Next locally, and removes the fixture afterwards.
If a run is forcibly terminated, inspect and remove
src/app/[locale]/editor-e2e.test/page.tsx before building.

The fixture renders the production ProseEditor. AI, session and document requests
are intercepted; no real API credits or database writes are used. History tests
reopen the shared editor with saved HTML, metadata, document ID and revision.
The persistence service has separate ownership, concurrency and retry tests.
These tests do not certify live provider availability or Railway deployment.

Production History uses the same component via editor/[id]/page.tsx and supplies
the database revision. Wait for “Saved to History” before closing the page.
A save failure is shown explicitly and can be retried with “Save now”; a
concurrent edit in another tab requires preserving local edits and reloading.

Undo and restoring a previous image apply to the current editing session;
History restores the latest saved document, not an archive of undo steps.
