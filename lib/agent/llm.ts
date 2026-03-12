/** userId is optional — when provided, LLM call is captured to PostHog */
let _currentUserId: string | null = null;
export function setLlmUserId(userId: string | null) { _currentUserId = userId; }
export function getLlmUserId(): string | null { return _currentUserId; }
