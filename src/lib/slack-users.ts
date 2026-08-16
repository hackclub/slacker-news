const userPromises = new Map<string, Promise<string | undefined>>();

function nameFromPayload(payload: unknown, preferHandle = false, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(payload)) {
    return payload
      .map((value) => nameFromPayload(value, preferHandle, depth + 1))
      .find((value): value is string => Boolean(value));
  }
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  const handleCandidates = [record.name, record.username, record.userName, record.user_name, record.handle, record.slackHandle, record.slack_handle];
  const displayCandidates = [record.displayName, record.display_name];
  const candidates = preferHandle
    ? [...handleCandidates, ...displayCandidates]
    : [...displayCandidates, ...handleCandidates];

  const name = candidates.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
  if (name) return name.replace(/^@+/, "");

  return [record.data, record.user, record.profile]
    .map((value) => nameFromPayload(value, preferHandle, depth + 1))
    .find((value): value is string => Boolean(value));
}

export function getSlackUserDisplayName(id: string): Promise<string | undefined> {
  if (!/^[UW][A-Z0-9]+$/i.test(id)) return Promise.resolve(undefined);

  const cached = userPromises.get(id);
  if (cached) return cached;

  const request = fetch(`https://cachet.hackclub.com/get/users/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  })
    .then(async (response) => response.ok ? nameFromPayload(await response.json()) : undefined)
    .then(async (displayName) => {
      if (displayName) return displayName;

      for (const route of ["user", "users"]) {
        try {
          const response = await fetch(`https://flaron.halceon.dev/${route}/${encodeURIComponent(id)}`, {
            headers: { Accept: "application/json" },
          });
          if (response.ok) {
            const flaronName = nameFromPayload(await response.json());
            if (flaronName) return flaronName;
          }
        } catch { }
      }

      return undefined;
    })
    .catch(() => undefined);

  userPromises.set(id, request);
  request.then((displayName) => {
    if (!displayName && userPromises.get(id) === request) {
      userPromises.delete(id);
    }
  });
  return request;
}
