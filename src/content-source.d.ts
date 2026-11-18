// Both names are Vite aliases that astro.config.mjs points at one of two
// implementations, depending on CMS. They cannot be tsconfig `paths`: Astro
// turns those into aliases of its own, which would always pick the same file.
declare module "#content-source" {
  type FileSource = typeof import("./lib/content-source/file");
  export const cmsEnabled: boolean;
  export const loadPosts: FileSource["loadPosts"];
  export const loadChangelogs: FileSource["loadChangelogs"];
  export const loadPage: FileSource["loadPage"];
  export const loadPeople: FileSource["loadPeople"];
}

declare module "#live-loader" {
  export const emdashLoader:
    | (typeof import("emdash/runtime"))["emdashLoader"]
    | undefined;
}

declare module "#submitter-gate" {
  export const submitterGate: (typeof import("./cms/newsroom/submitters-none"))["submitterGate"];
}
