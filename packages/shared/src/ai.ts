/**
 * Gemini AI client — uses gemini-2.5-flash (Google AI Studio free tier).
 *
 * Set GEMINI_API_KEY in the scraper .env / GitHub Actions secrets.
 * If the key is absent the functions return null gracefully — pipeline continues without AI.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/** Hard cap on any single Gemini call — a hung request must not stall the pipeline run. */
const GEMINI_TIMEOUT_MS = 30_000;

async function callGemini(prompt: string, apiKey: string): Promise<string | null> {
  try {
    // API key travels in a header, never in the URL (URLs get logged everywhere).
    const res = await fetch(GEMINI_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[ai] Gemini API error: ${res.status} ${String(res.statusText).replace(/[\r\n]/g, ' ')}`);
      return null;
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ai] Gemini request failed: ${msg.replace(/[\r\n]/g, ' ')}`);
    return null;
  }
}

/**
 * Generates a concise, tailored cover letter for a job posting.
 * Returns null if GEMINI_API_KEY is not set or the API call fails.
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
  const apiKey = process.env['GEMINI_API_KEY'];
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

  return callGemini(prompt, apiKey);
}

/**
 * Enriches a raw job posting with structured signals (remote detection, spam
 * filter) used by the pipeline. Deliberately does NOT modify the description:
 * summaries were being prepended on every run (stacking) and AI-generated text
 * inflated the skills signal during scoring.
 *
 * Returns null if GEMINI_API_KEY is not set or the API call fails.
 */
export async function enrichJobDescription(params: {
  title: string;
  description: string;
}): Promise<{
  isRemote: boolean;
  isSpam: boolean;
} | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
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

  const raw = await callGemini(prompt, apiKey);
  if (!raw) return null;

  try {
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr) as { isRemote: boolean; isSpam: boolean };
  } catch {
    return null;
  }
}
