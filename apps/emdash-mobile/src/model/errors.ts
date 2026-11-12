/** A human message for a typed desktop error, which may or may not carry one. */
export function errorMessage(
  error: { type: string } & { message?: unknown },
  fallback: string
): string {
  return typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : `${fallback} (${error.type})`;
}
