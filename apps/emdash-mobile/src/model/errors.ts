/** A human message for a typed desktop error, which may or may not carry one. */
export function errorMessage(
  error: { type: string } & { message?: unknown },
  fallback: string
): string {
  return typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : `${fallback} (${error.type})`;
}

/** A human message for anything a Wire call or job may throw or reject with. */
export function describeError(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}
