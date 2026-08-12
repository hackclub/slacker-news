const userPromises = new Map<string, Promise<string | undefined>>();

export function getSlackUserDisplayName(id: string): Promise<string | undefined> {
  if (!/^[UW][A-Z0-9]+$/i.test(id)) return Promise.resolve(undefined);

  const cached = userPromises.get(id);
  if (cached) return cached;

  const request = fetch(`https://cachet.hackclub.com/get/users/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) return undefined;
      const user = await response.json() as { displayName?: unknown };
      return typeof user.displayName === "string" && user.displayName.trim()
        ? user.displayName.trim()
        : undefined;
    })
    .catch(() => undefined);

  userPromises.set(id, request);
  return request;
}
