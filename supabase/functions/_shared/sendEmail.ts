/**
 * Email sending helper — uses Resend.
 *
 * Requires RESEND_API_KEY secret in Supabase.
 * From address: noreply@triplanio.com (must be verified in Resend).
 *
 * Two modes:
 *   - template mode: pass `template: { id, variables }` → Resend renders a
 *     published template. Do NOT pass `body` in this mode.
 *   - text mode (legacy/fallback): pass `body` (plain text).
 *
 * If RESEND_API_KEY is not set, logs a warning and skips silently —
 * so missing config doesn't crash other logic (invite still creates the
 * notification even if the email fails to send).
 */

interface EmailPayload {
  to: string;
  subject: string;
  from_name?: string;
  body?: string;
  template?: {
    id: string;
    variables: Record<string, string | number>;
  };
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn('[sendEmail] RESEND_API_KEY not set — skipping email to', payload.to);
    return;
  }

  const fromName = payload.from_name || 'Triplanio';
  const fromEmail = Deno.env.get('EMAIL_FROM') || 'noreply@triplanio.com';

  const emailBody: Record<string, unknown> = {
    from: `${fromName} <${fromEmail}>`,
    to: [payload.to],
    subject: payload.subject,
  };
  if (payload.template) {
    emailBody.template = payload.template;
  } else {
    emailBody.text = payload.body ?? '';
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailBody),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('[sendEmail] Resend error', res.status, err);
  }
}
