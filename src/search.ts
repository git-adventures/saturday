/**
 * search.ts — DuckDuckGo web search for sat
 * Uses lite.duckduckgo.com/lite (no API key required).
 */

export async function webSearch(
  query: string,
  maxResults = 5,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Each result is spread across two adjacent <tr> blocks:
    //   first  <tr>: contains <a class="result-link">Title</a>
    //   second <tr>: contains <td class="result-snippet">Snippet</td>
    const results: { title: string; snippet: string }[] = [];

    // Extract all result-link titles in order
    const linkRe = /class=['"]result-link['"][^>]*>([^<]+)<\/a>/g;
    const titles: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      titles.push(decodeHtml(m[1].trim()));
    }

    // Extract all snippets in order
    const snippetRe = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
    const snippets: string[] = [];
    while ((m = snippetRe.exec(html)) !== null) {
      const text = m[1]
        .replace(/<b>/gi, '').replace(/<\/b>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) snippets.push(decodeHtml(text));
    }

    const count = Math.min(titles.length, snippets.length, maxResults);
    for (let i = 0; i < count; i++) {
      results.push({ title: titles[i]!, snippet: snippets[i]! });
    }

    if (results.length === 0) {
      // Fallback: DuckDuckGo Instant Answer JSON API
      return await ddgInstant(query, signal);
    }

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`);
    return `Today is ${today}.\n\nWeb search results for "${query}":\n\n${lines.join('\n\n')}`;
  } catch {
    return ddgInstant(query, signal);
  }
}

async function ddgInstant(query: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const parts: string[] = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    const topics = (data.RelatedTopics ?? []).filter((t: any) => t.Text).slice(0, 4);
    if (topics.length) parts.push(topics.map((t: any) => `- ${t.Text}`).join('\n'));
    if (parts.length === 0) return null;
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `Today is ${today}.\n\nWeb search results for "${query}":\n\n${parts.join('\n\n')}`;
  } catch {
    return null;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
