import posthog from 'posthog-js';

// ── Product analytics (PostHog) ───────────────────────────────────
// Every function here is a safe no-op when VITE_POSTHOG_KEY is unset,
// so local dev and preview builds never send events.
//
// Event naming: past-tense snake_case ("task_created", "logged_in").
// Never put emails, names, or note/task content in event properties —
// only ids, counts, and enum-like values (source, method, view).

const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY || '').trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let enabled = false;

export function initAnalytics() {
  if (!POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    persistence: 'localStorage+cookie',
    // Session replays are opt-in later; keep payloads light for now.
    disable_session_recording: true,
    mask_all_text: true,
  });
  enabled = true;
}

// Ties all past/future events on this device to the real user id, so
// funnels and retention cohorts follow the person across sessions.
export function identifyUser(user) {
  if (!enabled || !user?.id) return;
  posthog.identify(String(user.id), {
    username: user.username,
    role: user.role || 'user',
    created_at: user.createdAt,
  });
}

// Must run on logout so the next login on a shared browser doesn't
// get attributed to the previous user.
export function resetAnalytics() {
  if (!enabled) return;
  posthog.reset();
}

export function track(event, properties = {}) {
  if (!enabled) return;
  posthog.capture(event, properties);
}

export function trackWebVital({ name, value, rating }) {
  if (!enabled) return;
  posthog.capture('web_vital', { metric: name, value: +value.toFixed(1), rating });
}
