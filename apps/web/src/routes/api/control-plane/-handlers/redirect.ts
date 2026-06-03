/**
 * Framework-neutral redirect helper for control-plane handlers.
 *
 * The old Next handlers used `NextResponse.redirect(url)`, which emits a **307** status
 * (temporary redirect, method-preserving). Standard `Response.redirect()` defaults to 302,
 * which would change the observable status code that callers (CLI / self-host instances and
 * tests) assert on. This helper preserves the frozen 307 behavior with a plain Web `Response`.
 */
export function redirectResponse(url: URL | string, status = 307): Response {
  return new Response(null, {
    status,
    headers: { location: url.toString() },
  });
}
