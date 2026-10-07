'use strict';

/**
 * Vercel entry point — the backend runs here automatically.
 *
 * Vercel turns every file in /api into a serverless function. vercel.json
 * sends every /api/... request to this one file, which hands it to the same
 * API code that backend/server.js uses. Nothing needs to be started by hand.
 * The website itself (html, css, js, photos) is served by Vercel's CDN.
 */
const { handleApi } = require('../backend/src/app');

module.exports = async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');

  // The rewrite in vercel.json also passes the original path as ?apiPath=...
  // Use it if Vercel hands us the rewritten URL (/api/index) instead of the original.
  const apiPath = url.searchParams.get('apiPath');
  url.searchParams.delete('apiPath');
  const self = url.pathname.replace(/\/+$/, '');
  if (apiPath && (self === '/api' || self === '/api/index' || self === '/api/index.js')) {
    url.pathname = `/api/${apiPath.replace(/^\/+/, '')}`;
  }

  return handleApi(req, res, url);
};
