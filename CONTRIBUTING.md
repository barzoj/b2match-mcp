# Contributing

Thanks for helping improve `b2match-mcp`. Please also read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security policy](SECURITY.md).

## Development

Requires Node.js 20 or newer (see `.nvmrc`).

```bash
npm install
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
npm run test:coverage
```

Format locally with `npm run format`.

The live API smoke test is opt-in and skipped unless both `B2MATCH_LIVE_SMOKE=1` and `B2MATCH_SMOKE_EVENT` are set. Do not hardcode a real event slug or id in tests, docs, fixtures, or CI.

```bash
B2MATCH_LIVE_SMOKE=1 B2MATCH_SMOKE_EVENT='https://www.b2match.com/e/<event-slug>' npm run test:smoke
```

## Conventional Commits

This repository uses [Conventional Commits](https://www.conventionalcommits.org/). Release Please turns them into `CHANGELOG.md` entries, git tags, and GitHub Releases.

Examples:

- `feat: add compact participant summaries`
- `fix: alias DirectoryRoute id fields`
- `docs: add VS Code MCP config`
- `chore: bump vitest`
- `ci: upload coverage to Codecov`

Use `feat` / `fix` for user-facing changes. Breaking changes should include `BREAKING CHANGE:` in the footer.

## Read-only guard

MCP tools must remain query-only.

- `src/queryGuard.ts` parses every GraphQL document before it is sent.
- Mutations and subscriptions are rejected.
- Known "read-looking" write operations (profile-view tracking, mark-as-read, session attendance, bookmarks, and similar) are blocked by operation name even if they were wrapped as queries.
- CLI login may validate a session with a viewer **query** only. It does not send login mutations on behalf of the user.
- Tools that trigger B2match's own read/seen tracking on a query (`get_conversation`, full `list_notifications`) must stay gated behind `B2MATCH_ALLOW_SIDE_EFFECT_READS` and an explicit acknowledge argument.

**Write operations will not be accepted.** Pull requests that book meetings, send messages, mark notifications, or otherwise change B2match data will be closed.

## Rules for changes

- Do not add telemetry or analytics.
- Do not commit tokens, cookies, HAR files, uploaded research artifacts, downloaded event data, or personal data.
- Keep examples neutral. Use placeholders such as `example-event-2026`. Do not commit real event slugs or ids, participant/user IDs, names, emails, phone numbers, cookie names, or company names.
- Cookie name constants live in `src/cookies.ts`. Tests should import those constants instead of repeating literal names.
- Prefer small hand-written GraphQL queries over committed frontend bundle dumps.
- Update README and tests when changing auth, storage, or tool behavior.

## Releases and publishing

Maintainers merge to `main` using Conventional Commits. Release Please opens a release PR that bumps `package.json`, updates `CHANGELOG.md`, and tags a GitHub Release.

The `Release Please` workflow (`.github/workflows/release-please.yml`) publishes when it creates a release (`steps.release.outputs.release_created`):

```bash
npm publish --provenance --access public
```

`--provenance` requires a **public** repository. Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) for GitHub Actions, repo `barzoj/b2match-mcp`, workflow `release-please.yml` (OIDC, `id-token: write`). Do not set `NODE_AUTH_TOKEN` (even empty). To publish an existing tag: `gh workflow run release-please.yml -f publish_tag=vX.Y.Z`.

`.github/workflows/publish.yml` is `workflow_dispatch` only for tip-of-branch republish; tagged republishes use `release-please.yml` with `publish_tag`.

Do not publish from a laptop with a long-lived token unless you are recovering from a broken trusted-publisher setup.

## Before opening a PR

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
```

If you changed public API queries, optionally run the env-gated smoke test above.
