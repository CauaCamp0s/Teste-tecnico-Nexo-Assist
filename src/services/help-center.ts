import { db } from "@/lib/db";

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const ignoredWords = new Set([
  "como",
  "para",
  "qual",
  "quais",
  "quando",
  "onde",
  "estou",
  "esta",
  "esse",
  "essa",
  "meu",
  "minha",
  "nao",
  "com",
  "uma",
  "por",
  "que",
  "preciso",
  "ajuda",
  "problema",
]);

export async function searchHelpCenter(query: string) {
  const terms = [...new Set(normalize(query).match(/[a-z0-9]+/g) ?? [])].filter(
    (term) => term.length >= 3 && !ignoredWords.has(term),
  );
  if (terms.length === 0) return [];

  const articles = await db.article.findMany({ orderBy: { slug: "asc" } });
  return articles
    .map((article) => {
      const title = normalize(article.title);
      const content = normalize(article.content);
      const titleMatches = terms.filter((term) => title.includes(term)).length;
      const contentMatches = terms.filter((term) =>
        content.includes(term),
      ).length;
      return {
        article,
        score: titleMatches * 3 + contentMatches,
        relevant: titleMatches > 0 || contentMatches >= 2,
      };
    })
    .filter(({ relevant }) => relevant)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ article }) => ({
      id: article.id,
      title: article.title,
      content: article.content,
    }));
}
