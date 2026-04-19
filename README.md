# Golden Circle Analyzer

[![CI/CD Pipeline](https://github.com/alexmachulsky/golden-circle/actions/workflows/ci.yml/badge.svg)](https://github.com/alexmachulsky/golden-circle/actions/workflows/ci.yml)

Turn a rough business idea into a structured **WHY / HOW / WHAT** strategy using Simon Sinek's Golden Circle framework — powered by AI, streamed in real time, and rendered as an interactive visualization.

## Features

- **AI-powered analysis** — streams a structured breakdown (1 WHY, 4 HOWs, 3 WHATs, 1 positioning note) from Groq's `llama-3.3-70b-versatile`
- **Interactive SVG visualization** — clickable concentric rings highlight each layer of the strategy
- **Animated loading state** — Framer Motion entrance animations while the model is working
- **Light / dark theme** — toggle persisted via cookie, applied before first paint to avoid flash
- **Copy, print, and save-as-PDF** — export the result without leaving the page
- **Example prompts** — pre-filled business ideas to try instantly
- **Input validation** — 50–2000 character range enforced on client and server

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

3. Add your Groq API key to `.env.local` (get one at [console.groq.com](https://console.groq.com)):

```
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
| `npm run dev` | Start the Next.js dev server on port `7001` |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build on port `7001` |
| `npm run lint` | Run ESLint |
| `npx tsc --noEmit` | Type-check the project (same check as CI) |
| `npm test` | Run Vitest unit tests (single run, no watch) |
| `npm run test:watch` | Run Vitest in watch mode |

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | API key used by `app/api/analyze/route.ts` to call Groq |
| `TURNSTILE_SITE_KEY` | Production | Public site key used to render the verification challenge |
| `TURNSTILE_SECRET_KEY` | Production | Secret key used server-side to verify submitted challenge tokens |
| `UPSTASH_REDIS_REST_URL` | Production | Shared rate-limit backend URL |
| `UPSTASH_REDIS_REST_TOKEN` | Production | Shared rate-limit backend token |
| `TRUSTED_IP_HEADER` | Production | Trusted proxy-injected client IP header |

## Docker

Run with Docker Compose:

```bash
cp .env.local.example .env.local
# fill in only the non-secret settings in .env.local
mkdir -p secrets
# put the sensitive runtime values into:
#   secrets/groq_api_key.txt
#   secrets/upstash_redis_rest_token.txt
#   secrets/turnstile_secret_key.txt
docker compose up --build
```

The compose file binds the app to `127.0.0.1:7001` and expects sensitive values to be mounted as Docker secrets under `/run/secrets/*`. `.dockerignore` excludes local env files from the build context so secrets are never baked into the image.

Pre-built images are published to GitHub Container Registry on every merge to `main`. Use an immutable tag for production deployments:

```bash
docker pull ghcr.io/alexmachulsky/golden-circle:<git-sha>
```

### Kubernetes

Basic manifests for running on Minikube or EKS live in [`k8s/`](k8s/):

```
k8s/
  namespace.yaml
  configmap.yaml
  deployment.yaml
  service.yaml
```

Apply them with `kubectl apply -f k8s/` after creating the namespace and any required secrets.

## CI/CD

GitHub Actions runs on every push and pull request to `main`. The pipeline has five stages:

1. **Build** — compile source, produce Next.js artifacts
2. **Test** — unit tests via Vitest + React Testing Library
3. **Analyze** — lint, type-check, dependency audit
4. **Package** — Docker image build + Trivy vulnerability scan (results uploaded as SARIF)
5. **Publish** — push the image to GHCR (merges to `main` only, tagged with the commit SHA)

## How it works

1. `components/InputForm.tsx` collects the business idea, shows example prompts, and enforces the 50–2000 character range.
2. `app/api/analyze/route.ts` sanitizes input, checks for `GROQ_API_KEY`, and streams raw text from Groq back to the browser.
3. `components/GoldenCircleApp.tsx` reads the stream, handles the `__ERROR__` sentinel used for stream-time failures, cleans up common LLM JSON formatting mistakes, and parses the final response into the shared `AnalysisResult` type.
4. `components/ResultSection.tsx` renders the final strategy breakdown and coordinates the interactive circle UI from `components/GoldenCircle.tsx`.

## Project structure

| Path | Role |
| --- | --- |
| `app/page.tsx` | Renders the single-page app shell |
| `app/layout.tsx` | Root layout; injects theme-bootstrap script before paint |
| `app/api/analyze/route.ts` | Server route that calls Groq and streams the result |
| `app/globals.css` | Tailwind v4 theme tokens, global styles, and print/PDF rules |
| `components/GoldenCircleApp.tsx` | Top-level client state machine for `input`, `loading`, and `result` |
| `components/GoldenCircle.tsx` | SVG ring visualization for WHY / HOW / WHAT |
| `components/ResultSection.tsx` | Result cards, copy action, print action, and section focus |
| `components/InputForm.tsx` | Business-idea input with validation and example prompts |
| `components/ThemeToggle.tsx` | Light/dark theme switcher using `useSyncExternalStore` |
| `lib/prompt.ts` | System prompt, user prompt builder, and example business ideas |
| `lib/theme.ts` | Theme helpers: bootstrap script, cookie persistence, store subscription |
| `types/index.ts` | Shared response schema used across the app |

## Contributing

Before opening a PR, run the full check suite:

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```
