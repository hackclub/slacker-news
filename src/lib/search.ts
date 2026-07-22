import type { Post } from "./content";

const STOPWORDS = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
    "her", "was", "one", "our", "out", "his", "has", "had", "him", "how",
    "its", "who", "did", "yes", "she", "too", "use", "way", "why", "with",
    "that", "this", "from", "they", "them", "then", "than", "have", "will",
    "your", "what", "when", "were", "been", "into", "some", "more", "over",
    "such", "only", "also", "just", "like", "make", "made", "here", "very"
]);

export type TermFrequency = Record<string, number>;

export type SearchDocument = {
    url: string;
    title: string;
    excerpt: string;
    category: string;
    readingTime: number;
    text: string;
    titleTerms: TermFrequency;
    bodyTerms: TermFrequency;
};

export type SearchIndex = {
    weights: {
        titleExact: number;
        bodyExact: number;
        titlePrefix: number;
        bodyPrefix: number;
    };
    documents: SearchDocument[];
};

export function tokenize(text: string): string[] {
    return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (token) => token.length >= 2 && !STOPWORDS.has(token)
    );
}

function termFrequency(text: string): TermFrequency {
    const freq: TermFrequency = {};
    for (const token of tokenize(text)) {
        freq[token] = (freq[token] ?? 0) + 1;
    }
    return freq;
}

export function buildSearchIndex(posts: Post[]): SearchIndex {
    const documents: SearchDocument[] = posts.map((post) => ({
        url: post.url,
        title: post.title,
        excerpt: post.excerpt,
        category: post.category ?? "",
        readingTime: post.readingTime,
        text: post.paragraphs.join(" "),
        titleTerms: termFrequency(post.title),
        bodyTerms: termFrequency([post.excerpt, ...post.paragraphs].join(" "))
    }));

    return {
        weights: {
            titleExact: 10,
            bodyExact: 1,
            titlePrefix: 4,
            bodyPrefix: 0.4
        },
        documents
    };
}

export function scoreDocument(doc: SearchDocument, queryTerms: string[], weights: SearchIndex["weights"]): number {
    const tally = (freq: TermFrequency, exact: number, prefix: number) =>
        Object.entries(freq).reduce((score, [indexed, count]) =>
            score + queryTerms.reduce((sum, term) =>
                sum + (indexed === term ? count * exact : indexed.startsWith(term) ? count * prefix : 0), 0), 0);

    return tally(doc.titleTerms, weights.titleExact, weights.titlePrefix)
        + tally(doc.bodyTerms, weights.bodyExact, weights.bodyPrefix);
}
