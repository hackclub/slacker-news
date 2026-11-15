import { defineLiveCollection } from "astro:content";
import { emdashLoader } from "#live-loader";

// Astro requires live collections to be defined in this file. The loader only
// exists when the site is built with CMS=emdash (see astro.config.mjs).
export const collections = emdashLoader
  ? { _emdash: defineLiveCollection({ loader: emdashLoader() }) }
  : {};
