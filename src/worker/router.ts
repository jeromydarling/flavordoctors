import type { Env, RequestContext } from './types';
import { errorResponse } from './lib/util';
import { isStripeError } from './lib/stripe';

export type Handler = (req: Request, rc: RequestContext) => Promise<Response> | Response;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler) {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler });
    return this;
  }

  get(path: string, handler: Handler) {
    return this.on('GET', path, handler);
  }
  post(path: string, handler: Handler) {
    return this.on('POST', path, handler);
  }
  put(path: string, handler: Handler) {
    return this.on('PUT', path, handler);
  }
  delete(path: string, handler: Handler) {
    return this.on('DELETE', path, handler);
  }

  async handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      try {
        return await route.handler(req, { env, ctx, params, user: null });
      } catch (err) {
        console.error(`Unhandled error on ${req.method} ${url.pathname}:`, err);
        if (isStripeError(err)) {
          return errorResponse(`Payment provider error: ${err.message}`, 502);
        }
        return errorResponse('Internal server error', 500);
      }
    }
    return null;
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  // A trailing '*' wildcard matches the rest of the path.
  const hasWildcard = pattern[pattern.length - 1] === '*';
  if (hasWildcard ? actual.length < pattern.length - 1 : actual.length !== pattern.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p === '*') {
      params['*'] = actual.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(actual[i]);
    } else if (p !== actual[i]) {
      return null;
    }
  }
  return params;
}
