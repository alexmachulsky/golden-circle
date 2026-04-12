# Golden Circle Analyzer

Golden Circle Analyzer is a Next.js app that turns a rough business idea into a structured **WHY / HOW / WHAT** analysis using Simon Sinek's Golden Circle framework. Users paste a short description of their company, the app streams an AI-generated response, and the result is presented as an interactive concentric-circle visualization with supporting strategy notes.

## What the app does

- Accepts a business idea in freeform text
- Generates:
  - 1 WHY statement
  - 4 HOW items
  - 3 WHAT items
  - 1 positioning note
- Streams the analysis instead of waiting for a single blocking response
- Shows an animated loading state while the model is working
- Lets users explore the result through clickable WHY / HOW / WHAT rings
- Supports example prompts, copy-to-clipboard, and print / save-as-PDF actions

## Stack

- Next.js 16.2.3
- React 19.2.4
- TypeScript
- Tailwind CSS v4
- Framer Motion
- Groq SDK (`llama-3.3-70b-versatile`)

## Getting started

1. Install dependencies:

```bash
npm install
```

2. Create a local env file:

```bash
cp .env.local.example .env.local
```

3. Add your Groq API key to `.env.local`:

```bash
GROQ_API_KEY=your_api_key_here
```

4. Start the development server:

```bash
npm run dev
```

Open [http://localhost:7001](http://localhost:7001).

## Available scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Next.js dev server on port `7001` |
| `npm run build` | Creates a production build |
| `npm run start` | Serves the production build on port `7001` |
| `npm run lint` | Runs ESLint |

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | API key used by `app/api/analyze/route.ts` to call Groq |

## How it works

1. `components/InputForm.tsx` collects the business idea, shows example prompts, and enforces the `50` to `2000` character range.
2. `app/api/analyze/route.ts` sanitizes input, checks for `GROQ_API_KEY`, and streams raw text from Groq back to the browser.
3. `components/GoldenCircleApp.tsx` reads the stream, handles the `__ERROR__` sentinel used for stream-time failures, cleans up common LLM JSON formatting mistakes, and parses the final response into the shared `AnalysisResult` type.
4. `components/ResultSection.tsx` renders the final strategy breakdown and coordinates the interactive circle UI from `components/GoldenCircle.tsx`.

## Project structure

| Path | Role |
| --- | --- |
| `app/page.tsx` | Renders the single-page app shell |
| `app/api/analyze/route.ts` | Server route that calls Groq and streams the result |
| `components/GoldenCircleApp.tsx` | Top-level client state machine for `input`, `loading`, and `result` |
| `components/GoldenCircle.tsx` | SVG ring visualization for WHY / HOW / WHAT |
| `components/ResultSection.tsx` | Result cards, copy action, print action, and section focus |
| `lib/prompt.ts` | System prompt, user prompt builder, and example business ideas |
| `types/index.ts` | Shared response schema used across the app |
| `app/globals.css` | Tailwind v4 theme tokens and global styles |

## Development notes

- The app is effectively a single-page experience with one API route: `POST /api/analyze`.
- The API response is streamed as `text/plain`, not as incremental JSON.
- Tailwind uses the v4 CSS-first setup; custom theme tokens live in `app/globals.css`, not in a `tailwind.config.*` file.
- Components in `components/` are client components.
- Print styling for the "Save as PDF" flow is also defined in `app/globals.css`.
- There is currently no automated test suite.
