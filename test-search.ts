import { webSearch } from './src/search.js';

async function main() {
  console.log('Testing webSearch with query: "latest AI news 2026"');
  console.log('---');

  const result = await webSearch('latest AI news 2026', 5);

  if (result) {
    console.log('SUCCESS — got results:\n');
    console.log(result);
  } else {
    console.log('FAILED — webSearch returned null');

    // Debug: fetch raw HTML and test the regex directly
    console.log('\nDEBUG: Testing regex against raw HTML...');
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent('latest AI news 2026')}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await res.text();

    const linkRe = /class=['"]result-link['"][^>]*>([^<]+)<\/a>/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = linkRe.exec(html)) !== null) {
      console.log(`Title ${++count}: ${m[1].trim()}`);
    }
    console.log(`Total titles found with new regex: ${count}`);

    const snippetRe = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
    count = 0;
    while ((m = snippetRe.exec(html)) !== null) {
      count++;
    }
    console.log(`Total snippets found with new regex: ${count}`);
  }
}

main().catch(console.error);
