// Same job as proxy_server.py for local dev, rewritten for Netlify (which
// runs JavaScript/TypeScript functions, not Python). Moth's API sends no
// Access-Control-Allow-Origin header, confirmed by testing, so a browser
// page can never call it directly. This relays /proxy?url=<target> to that
// target server-side, where CORS doesn't apply, and adds permissive CORS
// headers to the response so the browser accepts it.
//
// The API key itself travels in the request's own Authorization header,
// set by the page's JS from whatever the visitor typed in. This function
// never sees or stores a key of its own, each visitor brings their own.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "*",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return new Response("missing url query param", { status: 400, headers: CORS_HEADERS });
  }

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("content-length");
  // Don't forward the browser's Accept-Encoding: some upstream responses
  // come back zstd-compressed, which Response/fetch doesn't auto-decode,
  // corrupting the body. Leaving this out lets fetch negotiate gzip, which
  // it does decode automatically.
  headers.delete("accept-encoding");

  const body = (req.method === "GET" || req.method === "HEAD") ? undefined : await req.arrayBuffer();
  // Fully buffering the body (rather than streaming req.body through) before
  // forwarding it. Streaming a request body through a serverless function is
  // a known way to subtly corrupt a binary upload, and a signed upload URL
  // will reject a corrupted body outright rather than partially accept it.

  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, body });
  } catch (err) {
    return new Response(String(err), { status: 502, headers: CORS_HEADERS });
  }

  const respHeaders = new Headers(CORS_HEADERS);
  respHeaders.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) respHeaders.set("Retry-After", retryAfter);

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
};

export const config = { path: "/proxy" };
