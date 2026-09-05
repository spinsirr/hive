/** Start OAuth where its host-only nonce will also be read on callback. */
export function canonicalGitHubLoginUrl(
  requestUrl: string,
  callbackUrl = process.env.GITHUB_APP_CALLBACK_URL?.trim(),
  requestHost?: string | null,
) {
  if (!callbackUrl) throw new Error("GitHub callback URL is not configured.");
  const request = new URL(requestUrl);
  // NextRequest normalizes loopback names in its URL. The browser's actual Host
  // matters for host-only cookies, but never controls the redirect destination.
  if (requestHost) request.host = requestHost;
  const callback = new URL(callbackUrl);
  if (request.origin === callback.origin) return null;

  const destination = new URL("/api/github/login", callback.origin);
  destination.search = request.search;
  return destination;
}
