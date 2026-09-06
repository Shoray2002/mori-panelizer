# Issue tracker

Issues and specs live as local Markdown files.

- Feature directory: `.scratch/<feature-slug>/`.
- Spec: `.scratch/<feature-slug>/spec.md`.
- Tickets: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`,
  numbered from `01`, one file per ticket.
- Triage state: a `Status:` line near the top, using
  `docs/agents/triage-labels.md`.
- Conversation history: append under `## Comments`.

When asked to publish an issue, create its ticket file.
When asked to fetch a ticket, read its referenced path.
If a number matches several features, ask which feature.

## Wayfinding

- Map: `.scratch/<effort>/map.md`, containing Notes,
  Decisions-so-far, and Fog.
- Child tickets use the numbered issues directory above.
- Record `Type:` as research, prototype, grilling, or task.
- Wayfinding uses `Status: open`, `claimed`, or `resolved`.
- Record dependencies as `Blocked by: NN, NN`.
- A ticket is unblocked when all listed blockers are resolved.
- Select the first numbered open, unblocked, unclaimed ticket.
- Save `Status: claimed` before starting work.
- On resolution, append `## Answer`, set `Status: resolved`,
  and add a summary and ticket link to the map's Decisions-so-far.
