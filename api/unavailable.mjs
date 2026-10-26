// The existing API needs Cloudflare D1, R2, Queues and owner authentication.
// Fail explicitly until a production backend and its authentication are connected.
export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.statusCode = 503;
  response.end(JSON.stringify({error: {
    code: 'BACKEND_NOT_CONFIGURED',
    message: 'Production backend is not connected yet. Job sync, profiles and resumes are unavailable on this deployment.'
  }}));
}
