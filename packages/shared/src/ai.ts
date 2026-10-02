/**
 * Gemini AI client — uses gemini-1.5-flash (free tier: 15 req/min, 1M tokens/day).
 *
 * Set GEMINI_API_KEY in the scraper .env / GitHub Actions secrets.
 * If the key is absent the functions return null gracefully — pipeline continues without AI.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

async function callGemini(prompt: string, apiKey: string): Promise<string | null> {
  const res = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
    }),
  });

  if (!res.ok) {
    console.warn(`[ai] Gemini API error: ${res.status} ${String(res.statusText).replace(/[\r\n]/g, ' ')}`);
    return null;
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
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
 * Enriches a raw job description — extracts structured signals to improve scoring accuracy.
 * Returns null if GEMINI_API_KEY is not set or the API call fails.
 */
export async function enrichJobDescription(params: {
  title: string;
  description: string;
}): Promise<{
  isRemote: boolean;
  detectedSeniority: 'junior' | 'mid' | 'senior' | null;
  isSpam: boolean;
  cleanSummary: string;
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
  "detectedSeniority": "junior" or "mid" or "senior" or null,
  "isSpam": true or false (true if this is a recruiter spam post, MLM, unpaid, or not a real job),
  "cleanSummary": "one sentence summary of the role"
}`;

  const raw = await callGemini(prompt, apiKey);
  if (!raw) return null;

  try {
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr) as {
      isRemote: boolean;
      detectedSeniority: 'junior' | 'mid' | 'senior' | null;
      isSpam: boolean;
      cleanSummary: string;
    };
  } catch {
    return null;
  }
}
