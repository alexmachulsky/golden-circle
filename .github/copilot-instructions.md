# Copilot Instructions

## ⚠️ Critical: Non-Standard Next.js Version

This project uses **Next.js 16.2.3** with **React 19.2.4** — versions with breaking changes vs. common training data. Before writing any Next.js or React code, check `node_modules/next/dist/docs/` for current APIs and heed any deprecation notices.

## Commands

```bash
npm run dev      # Dev server on http://localhost:7001 (not 3000)
npm run build    # Production build
npm run lint     # ESLint
```

There is no test suite.

## Architecture

Single-page app: user inputs a business idea → POST to `/api/analyze` → streams back AI-generated JSON → rendered as an interactive Golden Circle visualization.

**Data flow:**
1. `GoldenCircleApp` (client component) manages app state: `'input' | 'loading' | 'result'`
2. On submit, POSTs `{ businessIdea }` to `/api/analyze`
3. The API route calls Groq (`llama-3.3-70b-versatile`) with streaming enabled and pipes `text/plain` chunks back directly — **not JSON streaming**
4. The client accumulates the full text stream, then parses it as JSON into `AnalysisResult`

**Key modules:**
- `lib/prompt.ts` — `SYSTEM_PROMPT`, `buildUserPrompt()`, and `EXAMPLES` (example business ideas for the UI)
- `types/index.ts` — all shared TypeScript types (`AnalysisResult`, `WhySection`, `HowItem`, `WhatItem`, `ActiveSection`)
- `app/api/analyze/route.ts` — the only API route; uses Groq SDK, requires `GROQ_API_KEY` env var
- `components/GoldenCircleApp.tsx` — top-level client orchestrator
- `components/GoldenCircle.tsx` — interactive SVG with concentric ring geometry via `annulusPath()`

## Key Conventions

### Streaming & error protocol
The API streams raw text. Errors are signaled with the prefix `__ERROR__` (e.g. `__ERROR__rate limit exceeded`), not via HTTP error status codes after the stream starts. The client checks for this prefix before JSON parsing.

### LLM response cleanup (client-side)
Because LLMs sometimes wrap JSON in markdown fences or add trailing commas, `GoldenCircleApp` does cleanup before `JSON.parse`:
- Strips ` ```json ` / ` ``` ` fences
- Extracts the outermost `{…}` by scanning for first `{` and last `}`
- Removes trailing commas before `}` or `]`

### Tailwind v4 — CSS-based theming
There is **no `tailwind.config.js`**. Custom colors are declared in `app/globals.css` using the `@theme` block:
- `navy-{600,700,800,900,950}` — dark blue-black backgrounds
- `gold-{100–700}` — amber/gold accent palette

Use these tokens in classnames (e.g. `bg-navy-800`, `text-gold-400`, `border-gold-500/30`). Do not add a config file.

### All components are Client Components
Every file in `components/` has `'use client'` at the top. `app/page.tsx` and `app/layout.tsx` are the only Server Components. Keep it this way — there is no server-side data fetching in components.

### Path aliases
Use `@/` for all imports from the project root (e.g. `@/components/InputForm`, `@/lib/prompt`, `@/types`).

### Input validation
- Min 50 chars, max 2000 chars (enforced both client and server)
- Server strips HTML/XML tags before sending to the LLM

### AI response shape
The LLM is instructed to return exactly **4 HOW items** and **3 WHAT items**. The full schema is defined in `types/index.ts` as `AnalysisResult`.

### Animations
Framer Motion is used for entrance animations on the SVG rings and result cards. Animation variants are defined inline per component (not in a shared file). Use `motion.*` components with `variants`, `initial`, `animate`, and `custom` (for staggered delays).
