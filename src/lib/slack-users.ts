const userPromises = new Map<string, Promise<string | undefined>>();
const cachetPromises = new Map<string, Promise<unknown>>();

// One Cachet lookup per user, shared by the name and the profile picture.
// A failed lookup is forgotten so the next render tries again.
function cachetUser(id: string): Promise<unknown> {
  const cached = cachetPromises.get(id);
  if (cached) return cached;
  const request = fetch(
    `https://cachet.hackclub.com/users/${encodeURIComponent(id)}`,
    { headers: { Accept: "application/json" } },
  )
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);
  cachetPromises.set(id, request);
  void request.then((payload) => {
    if (payload === undefined && cachetPromises.get(id) === request) {
      cachetPromises.delete(id);
    }
  });
  return request;
}

// The user's Slack profile picture at 72px, straight from Slack's CDN, or
// undefined when Cachet doesn't know it. Slack serves each picture at several
// sizes; 72px is plenty for avatars shown at 20-40px.
export async function getSlackUserAvatarUrl(
  id: string,
): Promise<string | undefined> {
  if (!/^[UW][A-Z0-9]+$/i.test(id)) return undefined;
  const payload = (await cachetUser(id)) as { imageUrl?: unknown } | undefined;
  const imageUrl = payload?.imageUrl;
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
    return undefined;
  }
  return imageUrl.replace(/_(\d+|original)\.(png|jpe?g|gif|webp)$/i, "_72.$2");
}

// Lookup services answer with a stand-in name while they cannot reach Slack.
// Treat those like no answer, so the next source (or the supplied name) wins.
function isPlaceholderName(name: string): boolean {
  return /^(unknown|slack user)$/i.test(name) || /^[UW][A-Z0-9]+$/.test(name);
}

function nameFromPayload(
  payload: unknown,
  preferHandle = false,
  depth = 0,
): string | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(payload)) {
    return payload
      .map((value) => nameFromPayload(value, preferHandle, depth + 1))
      .find((value): value is string => Boolean(value));
  }
  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  const handleCandidates = [
    record.name,
    record.username,
    record.userName,
    record.user_name,
    record.handle,
    record.slackHandle,
    record.slack_handle,
  ];
  const displayCandidates = [record.displayName, record.display_name];
  const candidates = preferHandle
    ? [...handleCandidates, ...displayCandidates]
    : [...displayCandidates, ...handleCandidates];

  const name = candidates
    .find(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    )
    ?.trim();
  if (name && !isPlaceholderName(name.replace(/^@+/, ""))) {
    return name.replace(/^@+/, "");
  }

  return [record.data, record.user, record.profile]
    .map((value) => nameFromPayload(value, preferHandle, depth + 1))
    .find((value): value is string => Boolean(value));
}

export function getSlackUserDisplayName(
  id: string,
): Promise<string | undefined> {
  if (!/^[UW][A-Z0-9]+$/i.test(id)) return Promise.resolve(undefined);

  const cached = userPromises.get(id);
  if (cached) return cached;

  const request = cachetUser(id)
    .then((payload) => (payload ? nameFromPayload(payload) : undefined))
    .then(async (displayName) => {
      if (displayName) return displayName;

      for (const route of ["user", "users"]) {
        try {
          const response = await fetch(
            `https://flaron.halceon.dev/${route}/${encodeURIComponent(id)}`,
            {
              headers: { Accept: "application/json" },
            },
          );
          if (response.ok) {
            const flaronName = nameFromPayload(await response.json());
            if (flaronName) return flaronName;
          }
        } catch {}
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
