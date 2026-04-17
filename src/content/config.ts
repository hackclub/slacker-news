import { defineCollection, z } from "astro:content";

const posts = defineCollection({
    type: "content",
    schema: z.object({
        title: z.string(),
        date: z.coerce.date(),
        author: z.string().optional(),
        category: z.string().optional(),
        excerpt: z.string().optional()
    })
});

const pages = defineCollection({
    type: "content",
    schema: z.object({
        title: z.string().optional()
    })
});

export const collections = {
    posts,
    pages
};