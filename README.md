# sat

A terminal AI client. Chat with GPT, Claude, Gemini, Grok, Groq, or Ollama — straight from your terminal.

Built on a Saturday, hence the name.

## Install

```bash
git clone https://github.com/YOURNAME/sat
cd sat
npm install
npm start
```

## Commands

| Command | Description |
|---------|-------------|
| `/model gpt \| claude \| gemini \| grok \| groq \| ollama` | Switch provider |
| `/search on \| off` | Toggle web search |
| `/read <path>` | Load a file or PDF for Q&A |
| `/read <n>.` | Load chapter n from PDF table of contents |
| `/save` | Save conversation to `~/.sat/history/` |
| `/load [n]` | List or restore a saved session |
| `/clear` | Clear conversation |
| `/keys` | Add or update API keys |
| `/help` | Show all commands |
| `/exit` | Quit |

## Requirements

- Node.js 18+
- `pdftotext` for PDF support (`sudo apt install poppler-utils`)
- API key for at least one provider (set up on first run)

## Providers

| Key | Provider | Notes |
|-----|----------|-------|
| `gpt` | OpenAI | GPT-4o |
| `claude` | Anthropic | Claude Sonnet |
| `gemini` | Google | Gemini 2.0 Flash |
| `grok` | xAI | Grok 3 |
| `groq` | Groq | Llama 3.3 70B, free tier |
| `ollama` | Ollama | Local models, no key needed |
