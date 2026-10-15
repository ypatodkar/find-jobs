// Same-origin API forwarding keeps the account cookie first party. Description
// shards and every other static route remain with Pages' asset server.
const API_ORIGIN = 'https://v7ogkcujy5bcq6hhyygjrs6v5y0xygut.lambda-url.us-east-1.on.aws';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!/^\/api\/(auth|sync|resumes|match)(\/|$)/.test(url.pathname)) return env.ASSETS.fetch(request);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('x-forwarded-proto', 'https');
    try {
      const target = new URL(url.pathname + url.search, API_ORIGIN);
      return await fetch(target, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' });
    } catch {
      return Response.json({ error: 'The account service is temporarily unavailable. Please try again.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
};
