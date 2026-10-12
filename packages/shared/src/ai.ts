/**
 * AI client — uses OpenRouter (OpenAI-compatible API).
 *
 * Set OPENROUTER_API_KEY in the scraper .env / GitHub Actions secrets.
 * Optionally set OPENROUTER_MODEL to override the default model.
 *
 * If the key is absent the functions return null gracefully — pipeline continues without AI.
 */

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';

/** Default model — cheap and fast, good for classification/generation tasks. */
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

/** Hard cap on any single AI call — a hung request must not stall the pipeline run. */
const AI_TIMEOUT_MS = 30_000;

async function callOpenRouter(prompt: string, apiKey: string): Promise<string | null> {
  const model = process.env['OPENROUTER_MODEL'] ?? DEFAULT_MODEL;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(OPENROUTER_API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/mustaphahaadi/job-me',
          'X-Title': 'job-me pipeline',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });

      if (res.status === 429 && attempt === 1) {
        console.warn('[ai] OpenRouter rate limit hit (429). Retrying after 6s backoff...');
        await new Promise(resolve => setTimeout(resolve, 6000));
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[ai] OpenRouter API error: ${res.status} ${String(res.statusText).replace(/[\r\n]/g, ' ')} — ${body.slice(0, 200).replace(/[\r\n]/g, ' ')}`);
        return null;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };

      return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      if (attempt === 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai] OpenRouter request failed: ${msg.replace(/[\r\n]/g, ' ')}`);
      return null;
    }
  }
  return null;
}

/** Resolves the API key from env — supports OPENROUTER_API_KEY (primary) and legacy GEMINI_API_KEY (ignored). */
function getApiKey(): string | null {
  return process.env['OPENROUTER_API_KEY'] ?? null;
}

/**
 * Generates a concise, tailored cover letter for a job posting.
 * Returns null if OPENROUTER_API_KEY is not set or the API call fails.
 */
export async function generateCoverLetter(params: {
  jobTitle: string;
  company: string | null;
  jobDescription: string | null;
  applicantName: string;
  applicantEmail: string;
  targetRoles: string[];
  skillVocabulary: string[];
}): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const { jobTitle, company, jobDescription, applicantName, applicantEmail, targetRoles, skillVocabulary } = params;

  const descSnippet = jobDescription
    ? jobDescription.slice(0, 800).replace(/\s+/g, ' ')
    : 'No description available.';

  const prompt = `Write a concise, professional cover letter (3 short paragraphs, max 200 words) for the following job application.

Job Title: ${jobTitle}
Company: ${company ?? 'the company'}
Job Description (excerpt): ${descSnippet}

Applicant: ${applicantName} (${applicantEmail})
Target roles: ${targetRoles.join(', ')}
Key skills: ${skillVocabulary.slice(0, 15).join(', ')}

Requirements:
- Address it to the hiring team (no specific name)
- Paragraph 1: Express genuine interest in the role and company
- Paragraph 2: Highlight 2-3 most relevant skills from the job description
- Paragraph 3: Brief closing with call to action
- Do NOT include a subject line, date, or address header
- Do NOT use placeholder text like [Your Name] — use the actual applicant name
- Plain text only, no markdown`;

  return callOpenRouter(prompt, apiKey);
}

/**
 * Enriches a raw job posting with structured signals (remote detection, spam
 * filter) used by the pipeline. Deliberately does NOT modify the description:
 * summaries were being prepended on every run (stacking) and AI-generated text
 * inflated the skills signal during scoring.
 *
 * Returns null if OPENROUTER_API_KEY is not set or the API call fails.
 */
export async function enrichJobDescription(params: {
  title: string;
  description: string;
}): Promise<{
  isRemote: boolean;
  isSpam: boolean;
} | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const descSnippet = params.description.slice(0, 1000).replace(/\s+/g, ' ');

  const prompt = `Analyse this job posting and respond with ONLY a JSON object, no markdown, no explanation.

Job Title: ${params.title}
Description: ${descSnippet}

Respond with exactly this JSON structure:
{
  "isRemote": true or false,
  "isSpam": true or false (true if this is a recruiter spam post, MLM, unpaid, or not a real job)
}`;

  const raw = await callOpenRouter(prompt, apiKey);
  if (!raw) return null;

  try {
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr) as { isRemote: boolean; isSpam: boolean };
  } catch {
    return null;
  }
}
