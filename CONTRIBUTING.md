# Contributing

Thanks for helping improve `b2match-mcp`.

## Development

```bash
npm install
npm run build
npm test
```

The live API smoke test is opt-in and skipped unless both `B2MATCH_LIVE_SMOKE=1` and `B2MATCH_SMOKE_EVENT` are set. Do not hardcode a real event slug or id in tests, docs, or CI.

```bash
B2MATCH_LIVE_SMOKE=1 B2MATCH_SMOKE_EVENT='https://www.b2match.com/e/<event-slug>' npm test -- tests/live-smoke.test.ts
```

## Rules for changes

- Keep the server read-only. MCP tools must not send GraphQL mutations/subscriptions. Tools that trigger B2match's own read/seen tracking on a query (`get_conversation`, full `list_notifications`) must stay gated behind `B2MATCH_ALLOW_SIDE_EFFECT_READS` and an explicit acknowledge argument.
- Do not add telemetry or analytics.
- Do not commit tokens, cookies, HAR files, uploaded research artifacts, downloaded event data, or personal data.
- Keep examples neutral. Do not commit real event slugs or ids; use placeholders such as `example-event-2026`. Do not commit participant/user IDs, names, emails, phone numbers, cookie names, or company names.
- Prefer small hand-written GraphQL queries over committed frontend bundle dumps.
- Update README and tests when changing auth, storage, or tool behavior.

## Before opening a PR

Run:

```bash
npm run build
npm test
```

If you changed public API queries, optionally run:

```bash
B2MATCH_SMOKE_EVENT='https://www.b2match.com/e/<event-slug>' npm run test:smoke
```
