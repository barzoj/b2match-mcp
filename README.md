# b2match-mcp

[![CI](https://github.com/barzoj/b2match-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/barzoj/b2match-mcp/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/barzoj/b2match-mcp/graph/badge.svg)](https://codecov.io/gh/barzoj/b2match-mcp)
[![npm version](https://img.shields.io/npm/v/b2match-mcp)](https://www.npmjs.com/package/b2match-mcp)
[![License: MIT](https://img.shields.io/npm/l/b2match-mcp)](LICENSE)
[![Node.js](https://img.shields.io/node/v/b2match-mcp)](https://nodejs.org/)
[![ToolSDK MCP Registry](https://badges.toolsdk.ai/badge/b2match-mcp)](https://toolsdk-ai.github.io/toolsdk-mcp-registry/#b2match-mcp)

Read-only MCP server for the [B2match](https://www.b2match.com/) event and matchmaking platform.

This package is designed to be run locally by the user via `npx` and stdio MCP transport.

**Disclaimer:** This project is unofficial and is not affiliated with, endorsed by, or supported by B2match. It uses B2match's undocumented web GraphQL API, so field availability can change without notice. Use it in accordance with [B2match's Terms of Service](https://www.b2match.com/) and GDPR. Participant profiles can be other people's personal data — keep exports local, respect each event's visibility rules, and do not harvest or republish personal data.

## Read-only and privacy guarantees

- The MCP server sends only GraphQL `query` operations. Mutations and subscriptions are parsed and rejected before any network call.
- Known "read-looking" write operations are explicitly blocked, including profile-view, mark-as-read, session-attendance, and bookmark mutations.
- B2match can still update its own read/seen counters when certain query fields are selected. See [Server-side side effects](#server-side-side-effects).
- It never calls Plausible, Sentry, Google Analytics, HubSpot, LinkedIn pixel, or any non-B2match analytics endpoint.
- It makes no external calls other than `https://api.b2match.com/v4/query` and the B2match Google login URL opened by the CLI.
- No telemetry or analytics are collected by this package.
- Tokens are never printed by tools or status commands.
- Tokens are stored in the OS keychain when available, otherwise in a `0600` config file.

## Install / run

Requires Node.js 22 or newer. On macOS with Apple Silicon, the recommended install path is `npx`; no native build step is required for the auth storage path.

```bash
npx -y b2match-mcp
```

From a checkout:

```bash
npm install
npm run build
node dist/cli.js
```

## MCP client config

### Claude Desktop

```json
{
  "mcpServers": {
    "b2match": {
      "command": "npx",
      "args": ["-y", "b2match-mcp"]
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "b2match": {
      "command": "npx",
      "args": ["-y", "b2match-mcp"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json` or user MCP settings:

```json
{
  "servers": {
    "b2match": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "b2match-mcp"]
    }
  }
}
```

For local development from this checkout:

```json
{
  "mcpServers": {
    "b2match": {
      "command": "node",
      "args": ["/absolute/path/to/b2match-mcp/dist/cli.js"]
    }
  }
}
```

## Authentication

Public event data works anonymously. Personal data such as viewer profile, active events, meetings, schedule, conversations, notifications, and availability requires a locally stored B2match session token.

### macOS / Linux login

```bash
b2match-mcp login https://www.b2match.com/e/<event-slug>
# or: npx b2match-mcp login https://www.b2match.com/e/<event-slug>
```

The default command:

1. Resolves the event anonymously and asks B2match for its Google login URL.
2. Launches your installed Chrome, Chromium, Edge, or Brave as a separate process.
3. Uses a dedicated persistent profile under the tool config directory, not your everyday browser profile.
4. Opens a remote-debugging port on `127.0.0.1` for that dedicated profile only (not your everyday browser). The port is closed when login finishes or times out.
5. Lets you complete Google sign-in and 2FA by hand. The CLI does not fill any form.
6. Waits for a JWT on the event tab URL (`www.b2match.com/e/<slug>?token=…`) or the event session cookie, validates it with a cheap viewer query, stores it, and closes that browser window. Chrome can 404 the post-Google event page before a cookie is set; the URL token is the path that works in that case.

Repeat logins are usually one click because the dedicated profile keeps the Google session.

macOS may show a Keychain access prompt the first time the CLI stores or reads the token. Approve access for `b2match-mcp`/your terminal if you want Keychain storage. If access is denied or Keychain is unavailable, the CLI falls back to a private config file.

### Paste-only / environment token

Use these only when the dedicated browser flow cannot run:

```bash
b2match-mcp login --paste
# or: npx b2match-mcp login --paste
B2MATCH_TOKEN='<session-cookie-value>' b2match-mcp
```

`B2MATCH_TOKEN` is used in memory and is not persisted. Do not pass tokens on the command line; that leaks them into shell history.

### Status / logout

```bash
b2match-mcp status
b2match-mcp logout
b2match-mcp logout --all
```

`logout` removes the stored B2match token only. `logout --all` also deletes the dedicated browser profile.

### Dedicated browser profile

Login uses a dedicated Chromium profile at `~/.config/b2match-mcp/browser-profile` (or `$B2MATCH_MCP_CONFIG_DIR/browser-profile` / `$XDG_CONFIG_HOME/b2match-mcp/browser-profile`). That profile keeps the Google session, so a later `login` is usually one click.

To wipe the Google session as well as the stored B2match token:

```bash
b2match-mcp logout --all
```

To delete only the profile and keep the stored token:

```bash
rm -rf ~/.config/b2match-mcp/browser-profile
```

`logout` without `--all` keeps the profile so the next login can reuse Google.

### Storage locations

- macOS: login Keychain via `/usr/bin/security` (`b2match-mcp` service, `default` account). After each save the CLI reads the item back; if the secret is missing or wrong it falls back to the private file and prints `keychain read-back failed, stored in file`.
- Linux: `secret-tool` / libsecret when installed and unlocked.
- Windows: private fallback file.
- Fallback file: `$B2MATCH_MCP_CONFIG_DIR/auth.json`, `$XDG_CONFIG_HOME/b2match-mcp/auth.json`, or `~/.config/b2match-mcp/auth.json`, written with `0600` permissions.
- `b2match-mcp status` reports `source: "keychain-unreadable"` (with a re-login hint) when a Keychain item exists but is empty or unreadable, instead of pretending you are logged out with `source: "none"`.
- Dedicated browser profile: `~/.config/b2match-mcp/browser-profile` (same config directory).

If a token is a JWT, the CLI records its `exp` claim as `expiresAt`. B2match also has opaque tokens, in which case lifetime cannot be known locally. A 401 on an authenticated viewer check is reported as invalid/expired and remembered for the process. Public tools then continue anonymously without deleting the stored token.

### Troubleshooting login

- **No supported browser found:** install Chrome, Chromium, Edge, or Brave, or use `b2match-mcp login --paste`.
- **Google blocks the window:** finish sign-in in the dedicated window if possible; otherwise use `--paste`.
- **Timeout / 404 after Google:** the CLI also reads a JWT from the event tab URL if Chrome 404s before a cookie is set. Finish sign-in and wait; or use `--paste`.
- **Keychain prompt denied:** run `b2match-mcp logout`, then `login` again and approve the prompt; or set `B2MATCH_MCP_DISABLE_KEYCHAIN=1` to use the private file fallback.
- **`status` shows `keychain-unreadable`:** the Keychain item is empty or corrupt and no usable `auth.json` was found. Run `b2match-mcp logout` then `login` again. If a file token still works, `status` uses `source: "file"` and sets a `warning` about the Keychain item instead.
- **Wrong/expired token:** run `b2match-mcp logout`, sign in again, and repeat `login`.

## Tools

Public/anonymous:

- `get_event` - event metadata, dates, registration window, login methods, and navigation. Numeric ids and slugs return the same fields.
- `list_participants` - compact participant summaries with pagination and optional search. Set `detail=true` for the fuller list payload.
- `get_participant` - one participant profile, without firing profile-view tracking.
- `list_organisations`, `get_organisation` - organisation/participation pages. Menu paths such as `/components/<id>` are resolved automatically.
- `list_opportunities`, `get_opportunity` - marketplace entries. Menu paths are resolved automatically; unknown opportunities return an MCP not-found error.
- `get_agenda`, `get_session`, `list_session_attendees`, `list_speakers`.

Authenticated:

- `auth_status`
- `list_my_events`
- `my_participation`
- `my_schedule`
- `my_meetings` - meetings by status; unfiltered responses use a compact availability summary unless `detail=true`
- `my_availability` - merged free ranges per day by default; `detail=true` for the full timeslot grid
- `find_meeting_slots`
- `meeting_recommendations`
- `list_conversations` - last-message previews; does not mark conversations as read
- `get_conversation` - disabled by default because fetching messages marks the conversation as read; see side effects
- `list_notifications` - unread/unseen counters by default; the full list resets unseen

Optional raw query:

- `graphql_read` is registered only when `B2MATCH_ALLOW_RAW=1`. It still rejects non-query operations and, unless `B2MATCH_ALLOW_SIDE_EFFECT_READS=1`, queries that select `messagesV2` or the notification list.

## Server-side side effects

This client never sends B2match mutations such as `MarkConversationAsSeen` or `ReadNotification`. B2match can still mutate its own read/seen state when a **query** selects certain fields:

- `get_conversation` (`messagesV2`) marks that conversation as read (unread-conversations count decreases).
- `list_notifications` with the `notifications(...)` list field resets the unseen counter (unseen → 0). The unread counter is unchanged. Fetching `notificationsCounter` alone does not reset unseen.
- `list_conversations` (including `lastMessageV2`) has no known side effects.

Gating:

- Default `list_notifications` returns only `unread`/`unseen` counters.
- `get_conversation` and the full notification list require `B2MATCH_ALLOW_SIDE_EFFECT_READS=1` **and** an explicit tool argument (`acknowledge_marks_read` / `acknowledge_marks_seen`).
- `graphql_read` rejects queries that select `messagesV2` or the `notifications` list unless the same env var is set.

Use `list_conversations` when you only need the last message.

Each event-scoped tool accepts a current event URL (`https://www.b2match.com/e/<slug>`), a legacy event URL (`https://<slug>.b2match.io`), a bare slug, or a numeric event id.

Authenticated tools return an MCP error when no token is stored, with instructions to log in. They say the token is invalid or expired only after a stored token receives HTTP 401.

## Development

```bash
npm install
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for lint, format, coverage, Conventional Commits, and the read-only guard.

Live smoke test against a public event (opt-in, not run in CI):

```bash
B2MATCH_LIVE_SMOKE=1 B2MATCH_SMOKE_EVENT='https://www.b2match.com/e/<event-slug>' npm test -- tests/live-smoke.test.ts
```

The smoke test is skipped unless both environment variables are set.

## Publishing

Releases are cut by Release Please from Conventional Commits on `main`. The same workflow (`.github/workflows/release-please.yml`) publishes with `npm publish --provenance --access public` when a release is created (OIDC trusted publishing only — no `NODE_AUTH_TOKEN`). Provenance requires a public repo. Configure npm trusted publishing against workflow `release-please.yml`. To republish an existing tag: `gh workflow run release-please.yml -f publish_tag=vX.Y.Z`. `.github/workflows/publish.yml` is a tip-of-branch manual republish only.

## Verification status

Verified in this repo:

- TypeScript build and unit tests.
- Query-only enforcement, event identifier parsing, cookie-name helpers, dedicated-browser launch args, section-path resolution, compact participant summaries, and 401/auth-error policy.
- Packed CLI `--help` / `status`.
- Opt-in anonymous live smoke that exercises every public tool when `B2MATCH_SMOKE_EVENT` is provided.

Requires a real login on a real machine:

- Dedicated-profile Google login, Keychain prompt, URL-token or cookie capture.
- Authenticated tools: `list_my_events`, `my_participation`, schedule, meetings, availability, meeting slots, recommendations, conversations, and notifications.

## License

MIT.
