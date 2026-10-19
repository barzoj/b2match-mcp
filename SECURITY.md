# Security policy

## Reporting a vulnerability

Please report security issues through [GitHub private vulnerability reporting](https://github.com/barzoj/b2match-mcp/security/advisories/new) (Settings → Code security → Private vulnerability reporting). If that is not enabled yet, open a minimal GitHub issue that says you have a security report to share, without including secrets, tokens, cookies, personal data, or exploit details.

Do not send vulnerability reports to a personal email address.

## Token handling

`b2match-mcp` uses the B2match event session cookie as a bearer token for authenticated reads. Cookie names live in `src/cookies.ts` and are not repeated here.

- Never paste tokens into GitHub issues, PRs, logs, screenshots, or chat transcripts.
- The CLI never prints stored token values.
- `B2MATCH_TOKEN` is read from the environment and is not persisted.
- Do not pass tokens as command-line flags; that leaks them into shell history and process listings.
- On macOS, the CLI first tries to store auth in the user's login Keychain through `/usr/bin/security`.
- On Linux, the CLI tries `secret-tool` when it is available.
- On Windows or when a keychain backend is unavailable/denied, the CLI falls back to a local `auth.json` file with `0600` permissions in the user's config directory.
- `logout` deletes both keychain and fallback-file entries where possible.

If a token is exposed, revoke it by logging out of B2match in the browser and run:

```bash
npx b2match-mcp logout
```

## Scope

This project is read-only by design and rejects GraphQL mutations/subscriptions in MCP tools. Security reports about accidental write calls, token disclosure, unsafe storage permissions, or unintended external network calls are in scope.
