import type { RequestContext } from '../types';
import { errorResponse } from '../lib/util';

/**
 * Serve imported media from R2 under /cdn/*, with single-range support so
 * <video> elements can seek. Keys are namespaced under cdn/ in the bucket;
 * only the media-import cron writes there.
 */
export async function serveMedia(req: Request, rc: RequestContext): Promise<Response> {
  const rest = rc.params['*'];
  if (!rest || rest.includes('..')) return errorResponse('Not found', 404);
  const key = `cdn/${rest}`;

  // R2 populates object.range even for full-body reads, so gate the 206 path
  // on the client having actually sent a Range header.
  const wantsRange = req.headers.has('Range');
  const object = await rc.env.PRODUCT_IMAGES.get(
    key,
    wantsRange ? { range: req.headers, onlyIf: req.headers } : { onlyIf: req.headers }
  );
  if (!object) return errorResponse('Not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');

  // onlyIf (If-None-Match etc.) satisfied → R2Object without a body → 304.
  if (!('body' in object) || !object.body) {
    return new Response(null, { status: 304, headers });
  }

  if (wantsRange && object.range && 'offset' in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}
