"use client";

import { leadInputSchema, type LeadInput, type LeadSubmitResult } from "@/lib/leads";

/**
 * Isolated API service layer for lead submission. The endpoint is configurable
 * via NEXT_PUBLIC_LEADS_ENDPOINT so the form can be pointed at a different
 * backend (CRM, serverless function, external API) without code changes —
 * defaults to the built-in `/api/leads` route.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_LEADS_ENDPOINT || "/api/leads";

export async function submitLead(input: LeadInput): Promise<LeadSubmitResult> {
  // Validate up-front so we surface field errors without a round-trip.
  const parsed = leadInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof LeadInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof LeadInput | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: "Please check the highlighted fields.", fieldErrors };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });

    let body: Partial<LeadSubmitResult> & { id?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* tolerate empty / non-JSON responses */
    }

    if (!res.ok) {
      return {
        ok: false,
        message:
          body.message ||
          (res.status === 429
            ? "Too many submissions. Please try again in a minute."
            : "Something went wrong while submitting your details. Please try again."),
        fieldErrors: body.fieldErrors,
      };
    }

    return {
      ok: true,
      message:
        body.message ||
        "Thank you for your interest! Our team has received your details and will get in touch with you shortly.",
    };
  } catch {
    // Network failure / backend unavailable — never fail silently.
    return {
      ok: false,
      message:
        "We couldn't reach the server. Please check your connection and try again, or email us directly.",
    };
  }
}
