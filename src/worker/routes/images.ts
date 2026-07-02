import type { RequestContext } from '../types';
import { errorResponse } from '../lib/util';

/** Serve product images from R2 through the Worker (long-lived edge cache). */
export async function serveImage(_req: Request, rc: RequestContext): Promise<Response> {
  const key = rc.params['*'];
  if (!key || !key.startsWith('products/')) return errorResponse('Not found', 404);
  const object = await rc.env.PRODUCT_IMAGES.get(key);
  if (!object) return errorResponse('Not found', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/png');
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}
