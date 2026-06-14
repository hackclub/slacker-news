const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#000"/>
  <path d="M18 18h28v8H18zM18 30h28v8H18zM18 42h18v8H18z" fill="#fff"/>
</svg>
`.trim();

export function GET() {
    return new Response(faviconSvg, {
        headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400"
        }
    });
}