import { mkdir, rm } from "node:fs/promises";
import { AuthStore, configDir, decodeJwtExpiry } from "./auth.js";
import {
  browserProfileDir,
  findBrowserExecutable,
  launchDedicatedBrowser,
  pollAuthCookie,
  reserveLocalPort,
  stopBrowserProcess,
  waitForDebugger
} from "./browser.js";
import { B2matchAuthError, B2matchClient } from "./client.js";
import { loginUsage } from "./invocation.js";
import { SOCIAL_LOGIN_URLS, VIEWER_STATUS } from "./queries.js";

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface LoginResult {
  storage: "keychain" | "file";
  obtainedVia: "browser" | "paste" | "env";
}

export async function loginWithDedicatedBrowser(
  event: string,
  authStore = new AuthStore(),
  client = new B2matchClient(authStore)
): Promise<LoginResult> {
  const resolved = await client.resolveEvent(event);
  const redirectUrl = resolved.websiteUrl ?? `https://www.b2match.com/e/${resolved.euid}`;
  const data = await client.query<{
    eventByEuidV2?: { googleLoginURL?: string | null };
  }>(SOCIAL_LOGIN_URLS, { euid: resolved.euid, redirectUrl, invitationCode: "" }, { cache: false });

  const googleLoginURL =
    data.eventByEuidV2?.googleLoginURL ??
    `https://api.b2match.com/integrations/login/google?event_id=${encodeURIComponent(resolved.id)}&redirect=${encodeURIComponent(redirectUrl)}`;

  const browser = findBrowserExecutable();
  if (!browser) {
    throw new Error(
      `No installed Chrome, Chromium, Edge, or Brave browser was found. Install one, or run \`${loginUsage("--paste")}\`.`
    );
  }

  const profileDir = browserProfileDir(configDir());
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const port = await reserveLocalPort();
  const child = launchDedicatedBrowser({
    executable: browser.executable,
    profileDir,
    port,
    url: googleLoginURL
  });

  console.error(
    `Opened Google login in a dedicated ${browser.kind} profile. Complete sign-in and any 2FA in that window; this tool will not fill the form.`
  );

  try {
    const debuggerUrl = await waitForDebugger(port);
    const timeoutMs = Number(process.env.B2MATCH_LOGIN_TIMEOUT_MS ?? DEFAULT_LOGIN_TIMEOUT_MS);
    const token = await pollAuthCookie({
      debuggerUrl,
      euid: resolved.euid,
      timeoutMs
    });
    return saveValidatedToken(authStore, client, token, resolved.id, "browser");
  } finally {
    stopBrowserProcess(child);
  }
}

export async function loginFromHiddenPrompt(
  readToken: () => Promise<string>,
  authStore = new AuthStore(),
  client = new B2matchClient(authStore),
  event?: string
): Promise<LoginResult> {
  console.error("Paste the B2match session cookie value. Input is hidden and is not written to shell history.");
  const token = (await readToken()).trim();
  if (!token) {
    throw new Error("No token was provided.");
  }

  let loginEventId: string | undefined;
  if (event) {
    loginEventId = (await client.resolveEvent(event)).id;
  }

  return saveValidatedToken(authStore, client, token, loginEventId, "paste");
}

async function saveValidatedToken(
  authStore: AuthStore,
  client: B2matchClient,
  token: string,
  loginEventId: string | undefined,
  obtainedVia: "browser" | "paste"
): Promise<LoginResult> {
  try {
    const viewer = await client.query<{ viewer?: { id?: string } }>(
      VIEWER_STATUS,
      {},
      { requireAuth: true, cache: false, token }
    );
    const storage = await authStore.save({
      token,
      loginEventId,
      userId: viewer.viewer?.id,
      obtainedVia,
      expiresAt: decodeJwtExpiry(token)
    });
    console.error(`Logged in successfully. Token stored in ${storage}.`);
    return { storage, obtainedVia };
  } catch (error) {
    if (error instanceof B2matchAuthError) {
      throw new Error("The provided session token was rejected by B2match. Sign in again and retry.", {
        cause: error
      });
    }
    throw error;
  }
}

export async function logoutLocal(options: { all?: boolean } = {}, dir = configDir()): Promise<void> {
  await new AuthStore(dir).clear();
  if (options.all) {
    await rm(browserProfileDir(dir), { recursive: true, force: true });
  }
}
