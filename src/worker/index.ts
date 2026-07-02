import type { Env } from './types';
import { Router } from './router';
import { register, login, logout, me } from './routes/auth';
import { listProducts, getProduct } from './routes/products';
import { createCheckout } from './routes/checkout';
import {
  createSubscription,
  getMySubscription,
  updateBoxItems,
  createPortalSession,
} from './routes/subscriptions';
import { listMyOrders } from './routes/account';
import {
  adminListProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminGenerateDescription,
  adminGenerateImage,
  adminListOrders,
  adminUpdateOrder,
} from './routes/admin';
import { stripeWebhook } from './routes/webhook';
import { serveImage } from './routes/images';
import { errorResponse } from './lib/util';

const router = new Router()
  // Auth
  .post('/api/auth/register', register)
  .post('/api/auth/login', login)
  .post('/api/auth/logout', logout)
  .get('/api/auth/me', me)
  // Catalog
  .get('/api/products', listProducts)
  .get('/api/products/:slug', getProduct)
  // Checkout & subscriptions
  .post('/api/checkout', createCheckout)
  .post('/api/subscribe', createSubscription)
  .get('/api/account/subscription', getMySubscription)
  .put('/api/account/subscription/items', updateBoxItems)
  .post('/api/account/portal', createPortalSession)
  .get('/api/account/orders', listMyOrders)
  // Admin
  .get('/api/admin/products', adminListProducts)
  .post('/api/admin/products', adminCreateProduct)
  .put('/api/admin/products/:id', adminUpdateProduct)
  .delete('/api/admin/products/:id', adminDeleteProduct)
  .post('/api/admin/products/:id/generate-description', adminGenerateDescription)
  .post('/api/admin/products/:id/generate-image', adminGenerateImage)
  .get('/api/admin/orders', adminListOrders)
  .put('/api/admin/orders/:id', adminUpdateOrder)
  // Stripe webhooks
  .post('/api/webhooks/stripe', stripeWebhook)
  // Product images from R2
  .get('/images/*', serveImage);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const matched = await router.handle(req, env, ctx);
    if (matched) return matched;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/')) {
      return errorResponse('Not found', 404);
    }
    // Everything else: the React SPA served from static assets.
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
