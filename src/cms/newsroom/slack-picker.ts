/**
 * Search as you type in the insert forms for a Slack user or channel.
 *
 * EmDash draws those forms itself, from the block definitions in
 * src/cms/rich/blocks.mjs, and has no search box for them. This watches for the
 * form to open, and under its first field shows matches from Slack (through
 * the newsroom plugin's `slack` route, which asks Flaron). Picking one fills in
 * the ID and the name. If the form's markup changes and this finds nothing, the
 * form still works as plain text boxes.
 */
type Hit = { id: string; name: string; detail?: string };
type Kind = "users" | "channels";

const ROUTE = "/_emdash/api/plugins/newsroom/slack";
const SLACK_ID = /^[UWC][A-Z0-9]{6,}$/;

async function search(kind: Kind, q: string): Promise<Hit[]> {
  try {
    const response = await fetch(ROUTE, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
      body: JSON.stringify({ kind, q }),
    });
    if (!response.ok) return [];
    const json = await response.json();
    return ((json?.data ?? json)?.hits ?? []) as Hit[];
  } catch {
    return [];
  }
}

/** Sets a text box the way typing would, so EmDash's form notices. */
function setValue(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function inputFor(dialog: HTMLElement, labelStart: string) {
  for (const label of dialog.querySelectorAll("label")) {
    if (label.textContent?.trim().toLowerCase().startsWith(labelStart)) {
      const control = (label as HTMLLabelElement).control;
      if (control instanceof HTMLInputElement) return control;
    }
  }
  return null;
}

function attach(dialog: HTMLElement) {
  if (dialog.dataset.slackPicker) return;
  const title = dialog.querySelector("h2")?.textContent ?? "";
  const kind: Kind | null = /slack user/i.test(title)
    ? "users"
    : /slack channel/i.test(title)
      ? "channels"
      : null;
  if (!kind) return;
  const box = inputFor(
    dialog,
    kind === "users" ? "slack user" : "slack channel",
  );
  const second = inputFor(dialog, kind === "users" ? "name" : "label");
  if (!box) return;
  dialog.dataset.slackPicker = "1";

  const list = document.createElement("div");
  list.setAttribute("role", "listbox");
  Object.assign(list.style, {
    position: "absolute",
    zIndex: "2147483000",
    display: "none",
    maxHeight: "220px",
    overflowY: "auto",
    background: "Canvas",
    color: "CanvasText",
    border: "1px solid rgba(128,128,128,.5)",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0,0,0,.35)",
    fontSize: "14px",
  } satisfies Partial<CSSStyleDeclaration>);
  dialog.appendChild(list);

  let hits: Hit[] = [];
  let active = 0;
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The dialog is moved with a transform, which makes it the reference for
  // anything inside it, so positions are measured from the dialog.
  const place = () => {
    const rect = box.getBoundingClientRect();
    const frame = dialog.getBoundingClientRect();
    list.style.left = `${rect.left - frame.left}px`;
    list.style.top = `${rect.bottom - frame.top + 4}px`;
    list.style.width = `${rect.width}px`;
  };
  const hide = () => {
    list.style.display = "none";
    hits = [];
  };
  const pick = (hit: Hit) => {
    setValue(box, hit.id);
    // A channel's label is its name; a person's field is their handle.
    if (second && !second.value) setValue(second, hit.name);
    hide();
  };
  const draw = () => {
    list.replaceChildren(
      ...hits.map((hit, index) => {
        const row = document.createElement("div");
        row.setAttribute("role", "option");
        row.textContent = `${kind === "users" ? "@" : "#"}${hit.name}${
          hit.detail ? `  ·  ${hit.detail}` : ""
        }`;
        Object.assign(row.style, {
          padding: "8px 12px",
          cursor: "pointer",
          background:
            index === active ? "rgba(128,128,128,.25)" : "transparent",
        });
        // mousedown, so the box keeps focus and the form is not told it blurred.
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pick(hit);
        });
        return row;
      }),
    );
    list.style.display = hits.length ? "block" : "none";
    place();
  };

  box.setAttribute("autocomplete", "off");
  box.addEventListener("input", () => {
    clearTimeout(timer);
    const q = box.value.trim();
    // A pasted ID needs no search.
    if (!q || SLACK_ID.test(q)) return hide();
    const mine = ++ticket;
    timer = setTimeout(async () => {
      const found = await search(kind, q);
      if (mine !== ticket) return;
      hits = found;
      active = 0;
      draw();
    }, 250);
  });
  box.addEventListener("keydown", (event) => {
    if (list.style.display === "none") return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active =
        (active + (event.key === "ArrowDown" ? 1 : -1) + hits.length) %
        hits.length;
      draw();
    } else if (event.key === "Enter" && hits[active]) {
      // Enter would submit the form; it picks the highlighted match instead.
      event.preventDefault();
      event.stopPropagation();
      pick(hits[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  });
  box.addEventListener("blur", () => setTimeout(hide, 150));
}

if (typeof document !== "undefined") {
  new MutationObserver(() => {
    for (const dialog of document.querySelectorAll<HTMLElement>(
      '[role="dialog"]',
    )) {
      attach(dialog);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
