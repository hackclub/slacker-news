/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * What the newsroom plugin adds to EmDash's admin pages. EmDash reads this
 * module for field widgets and sidebar sections; importing the others runs
 * what they set up on the page.
 *
 *  - rich-review: comments and suggested edits on the rich-text editor.
 *  - slack-picker: search as you type in the Slack insert forms.
 *  - sidebar: the "Links and visibility" section and the fields it holds.
 */
import "./rich-review";
import "./slack-picker";
import { SidebarSlots, sidebarWidgets } from "./sidebar";

/** Field widgets, by name. */
export const fields = { ...sidebarWidgets };

/** Sections of the editor's sidebar. */
export const contentEditorPanels = [
  {
    id: "details",
    title: "Links and visibility",
    component: SidebarSlots,
    collections: ["posts", "changelogs"],
    order: -10,
  },
];
