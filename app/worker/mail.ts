import type { Env } from "./auth";

export type Mail = {
  fromName: string; fromEmail: string; replyTo?: string | null;
  to: string; cc?: string | null; subject: string; text: string; html?: string;
  attachments?: { filename: string; contentBase64: string; mimeType: string }[];
};

/** Which way mail leaves: Google/other SMTP first (SMTP_USER + SMTP_PASS), Resend second (RESEND_API_KEY). */
export function mailMode(env: Env): "smtp" | "resend" | "none" {
  if (env.SMTP_USER && env.SMTP_PASS) return "smtp";
  if (env.RESEND_API_KEY) return "resend";
  return "none";
}

export const NOT_CONFIGURED =
  "Email is not set up yet: the SMTP_USER and SMTP_PASS secrets (Google app password for accounts@logia.co.za) are not saved on the Cloudflare Worker.";

/** Sends one message. Throws on any failure. Returns a provider id (or null). */
export async function deliver(env: Env, m: Mail): Promise<string | null> {
  const mode = mailMode(env);
  if (mode === "smtp") {
    const { WorkerMailer } = await import("worker-mailer");
    const user = env.SMTP_USER as string;
    const mailer = await WorkerMailer.connect({
      host: env.SMTP_HOST || "smtp.gmail.com",
      port: Number(env.SMTP_PORT || 465),
      secure: true,
      credentials: { username: user, password: env.SMTP_PASS as string },
      authType: "plain",
    });
    try {
      await mailer.send({
        from: { name: m.fromName, email: env.EMAIL_FROM || user },
        reply: m.replyTo || undefined,
        to: m.to,
        ...(m.cc ? { cc: m.cc } : {}),
        subject: m.subject,
        text: m.text,
        ...(m.html ? { html: m.html } : {}),
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.contentBase64, mimeType: a.mimeType })),
      });
    } finally {
      try { await mailer.close(); } catch { /* ignore */ }
    }
    return "smtp";
  }
  if (mode === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${m.fromName} <${env.EMAIL_FROM || "accounts@logia.co.za"}>`,
        to: [m.to], ...(m.cc ? { cc: [m.cc] } : {}), reply_to: m.replyTo || undefined,
        subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}),
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.contentBase64 })),
      }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(e.message || res.statusText || `HTTP ${res.status}`);
    }
    return ((await res.json()) as { id?: string }).id ?? null;
  }
  throw new Error(NOT_CONFIGURED);
}
