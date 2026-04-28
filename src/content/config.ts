import { defineCollection, z } from "astro:content";

const posts = defineCollection({
    type: "content",
    schema: z.object({
        title: z.string(),
        date: z.coerce.date(),
        author: z.string().optional(),
        category: z.string().optional(),
        excerpt: z.string().optional(),
        responseTo: z.union([z.string(), z.array(z.string())]).optional(),
        followUpTo: z.union([z.string(), z.array(z.string())]).optional(),
        series: z.object({
            name: z.string(),
            order: z.number().int().positive().optional(),
            description: z.string().optional()
        }).optional()
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