export const AUTH_COOKIE_PREFIX = "_AUTH_";
export const AUTH_COOKIE_FALLBACK = "_AUTH";
export const AUTH_COOKIE_DOMAIN_SUFFIX = "b2match.com";

export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
}

export function eventAuthCookieName(euid: string): string {
  return `${AUTH_COOKIE_PREFIX}${euid}`;
}

export function isB2matchAuthCookie(cookie: BrowserCookie, euid?: string): boolean {
  if (!cookie.value) {
    return false;
  }

  const domain = (cookie.domain ?? "").replace(/^\./, "").toLowerCase();
  if (domain && domain !== AUTH_COOKIE_DOMAIN_SUFFIX && !domain.endsWith(`.${AUTH_COOKIE_DOMAIN_SUFFIX}`)) {
    return false;
  }

  if (euid && cookie.name === eventAuthCookieName(euid)) {
    return true;
  }

  return cookie.name === AUTH_COOKIE_FALLBACK || cookie.name.startsWith(AUTH_COOKIE_PREFIX);
}

export function pickAuthCookie(cookies: BrowserCookie[], euid?: string): string | undefined {
  if (euid) {
    const exact = cookies.find(
      (cookie) => cookie.name === eventAuthCookieName(euid) && isB2matchAuthCookie(cookie, euid)
    );
    if (exact?.value) {
      return exact.value;
    }
  }

  return cookies.find((cookie) => isB2matchAuthCookie(cookie, euid))?.value;
}
