import Groq from 'groq-sdk';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompt';

const MODEL = 'llama-3.3-70b-versatile';

function sanitizeInput(input: string): string {
  // Remove any potential prompt injection patterns while preserving legitimate content
  return input
    .replace(/<\/?[a-z][^>]*>/gi, '') // strip HTML/XML tags
    .trim()
    .slice(0, 2000);
}

export async function POST(req: Request) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'The AI service is not configured. Please set GROQ_API_KEY.' },
      { status: 500 },
    );
  }

  let body: { businessIdea?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!body.businessIdea || typeof body.businessIdea !== 'string') {
    return Response.json({ error: 'businessIdea is required.' }, { status: 400 });
  }

  const sanitized = sanitizeInput(body.businessIdea);

  if (sanitized.length < 50) {
    return Response.json(
      { error: 'Please provide at least 50 characters describing your business idea.' },
      { status: 400 },
    );
  }

  const groq = new Groq({ apiKey });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await groq.chat.completions.create({
          model: MODEL,
          max_tokens: 2048,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(sanitized) },
          ],
        });

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }

        controller.close();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Analysis failed';
        controller.enqueue(encoder.encode(`__ERROR__${message}`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
