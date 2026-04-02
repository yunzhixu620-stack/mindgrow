// Cloudflare Worker - Reverse proxy for Vercel app
// Place in Cloudflare Workers dashboard

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // Change this to your Vercel URL
    const targetUrl = 'https://mindgrow-henna.vercel.app';
    
    url.hostname = new URL(targetUrl).hostname;
    url.protocol = 'https:';
    
    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
    });
    
    // Fix CORS headers
    const response = await fetch(newRequest);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    
    return newResponse;
  },
};
