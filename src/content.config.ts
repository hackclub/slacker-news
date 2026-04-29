import { defineCollection, z } from "astro:content";
import { glob } from 'astro/loaders';

const posts = defineCollection({
    loader: glob({ pattern: "**/*.mdx", base: "./src/content/posts" }),
    schema: z.object({
        title: z.string(),
        date: z.coerce.date(),
        author: z.string().optional(),
        category: z.string().optional(),
        excerpt: z.string().optional(),
        responseTo: z.union([z.string(), z.array(z.string())]).optional(),
        followUpTo: z.union([z.string(), z.array(z.string())]).optional()
    })
});

const pages = defineCollection({
    loader: glob({ pattern: "**/*.mdx", base: "./src/content/pages" }),
    schema: z.object({
        title: z.string().optional()
    })
});

export const collections = {
    posts,
    pages
};