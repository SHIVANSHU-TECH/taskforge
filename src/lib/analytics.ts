"use client";

/**
 * Modular analytics layer. The landing page fires semantic events through
 * `track(...)`; where those events go is decoupled from the call sites so a real
 * provider (GA4, Segment, PostHog, GTM) can be connected later without touching
 * components. By default events are pushed to `window.dataLayer` (GTM-ready) and,
 * in development, logged to the console.
 */

export type AnalyticsEvent =
  | "page_view"
  | "pdf_viewed"
  | "pdf_downloaded"
  | "pricing_viewed"
  | "interest_clicked"
  | "lead_form_opened"
  | "lead_form_submitted"
  | "lead_form_failed";

export type AnalyticsProps = Record<string, string | number | boolean | undefined>;
type Provider = (event: AnalyticsEvent, props: AnalyticsProps) => void;

const providers: Provider[] = [];

/** Connect an additional analytics sink (e.g. GA4, PostHog). Returns an unsubscribe fn. */
export function registerAnalyticsProvider(provider: Provider): () => void {
  providers.push(provider);
  return () => {
    const i = providers.indexOf(provider);
    if (i >= 0) providers.splice(i, 1);
  };
}

// Default GTM-compatible sink: harmless if no tag manager is installed.
const dataLayerProvider: Provider = (event, props) => {
  if (typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event: `landing_${event}`, ...props });
};
providers.push(dataLayerProvider);

/** Fire a semantic conversion event. Safe to call from anywhere (SSR no-ops). */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (typeof window === "undefined") return;
  const enriched = { ...props, ts: Date.now() };
  for (const p of providers) {
    try {
      p(event, enriched);
    } catch {
      /* analytics must never break the page */
    }
  }
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[analytics] ${event}`, enriched);
  }
}
