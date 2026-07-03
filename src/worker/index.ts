import type { Env } from './types';
import { Router } from './router';
import { register, login, logout, me } from './routes/auth';
import { listProducts, getProduct } from './routes/products';
import { createCheckout } from './routes/checkout';
import {
  createSubscription,
  getMySubscription,
  updateBoxItems,
  skipNextBox,
  pauseSubscription,
  resumeSubscription,
  createPortalSession,
} from './routes/subscriptions';
import { listMyOrders } from './routes/account';
import { submitQuiz, getMyProfile } from './routes/quiz';
import { getMyLoyalty, rateProduct, getMyRatings } from './routes/loyalty';
import { listDrops, joinWaitlist } from './routes/drops';
import { pharmacistChat } from './routes/pharmacist';
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
import {
  joinList,
  unsubscribe,
  trackOpen,
  trackClick,
  activePromo,
  landingPage,
  submitReview,
  listReviews,
  starterPackCheckout,
} from './routes/marketing';
import { supportChat, createTicket, myTickets } from './routes/support';
import {
  listCustomers,
  customerDetail,
  addNote,
  grantPoints,
  emailCustomer,
  listTickets,
  ticketDetail,
  replyTicket,
  setTicketStatus,
} from './routes/adminCustomers';
import {
  listCampaigns,
  createCampaign,
  draftCampaign,
  testSendCampaign,
  sendCampaign,
  listFlows,
  updateFlow,
  contactStats,
  exportContacts,
  listLandingPages,
  upsertLandingPage,
  listPromotions,
  createPromotion,
  deactivatePromotion,
  analytics,
  generateContent,
  generateLifestyleImage,
  sellSheet,
  rangeMeCsv,
  pendingReviews,
  moderateReview,
} from './routes/adminMarketing';
import { runScheduled } from './scheduled';
import { withPageMeta, robotsTxt, sitemapXml, llmsTxt } from './seo';
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
  // Intake Exam + Pharmacist
  .post('/api/quiz', submitQuiz)
  .post('/api/pharmacist', pharmacistChat)
  // Clinical Trials (limited drops)
  .get('/api/drops', listDrops)
  .post('/api/drops/:id/waitlist', joinWaitlist)
  // Checkout & subscriptions
  .post('/api/checkout', createCheckout)
  .post('/api/subscribe', createSubscription)
  .get('/api/account/subscription', getMySubscription)
  .put('/api/account/subscription/items', updateBoxItems)
  .post('/api/account/subscription/skip', skipNextBox)
  .post('/api/account/subscription/pause', pauseSubscription)
  .post('/api/account/subscription/resume', resumeSubscription)
  .post('/api/account/portal', createPortalSession)
  .get('/api/account/orders', listMyOrders)
  // My Chart extras
  .get('/api/account/profile', getMyProfile)
  .get('/api/account/loyalty', getMyLoyalty)
  .get('/api/account/ratings', getMyRatings)
  .post('/api/products/:id/rate', rateProduct)
  // Admin
  .get('/api/admin/products', adminListProducts)
  .post('/api/admin/products', adminCreateProduct)
  .put('/api/admin/products/:id', adminUpdateProduct)
  .delete('/api/admin/products/:id', adminDeleteProduct)
  .post('/api/admin/products/:id/generate-description', adminGenerateDescription)
  .post('/api/admin/products/:id/generate-image', adminGenerateImage)
  .get('/api/admin/orders', adminListOrders)
  .put('/api/admin/orders/:id', adminUpdateOrder)
  // Marketing: public surfaces
  .post('/api/waitlist', joinList)
  .get('/unsubscribe', unsubscribe)
  .post('/unsubscribe', unsubscribe)
  .get('/t/o', trackOpen)
  .get('/t/c', trackClick)
  .get('/api/promo/active', activePromo)
  .get('/lp/:slug', landingPage)
  .post('/api/checkout/starter-pack', starterPackCheckout)
  .get('/api/products/:slug/reviews', listReviews)
  .post('/api/products/:id/review', submitReview)
  // Support (Front Desk)
  .post('/api/support', supportChat)
  .post('/api/support/ticket', createTicket)
  .get('/api/account/tickets', myTickets)
  // Customer OS (admin)
  .get('/api/admin/customers', listCustomers)
  .get('/api/admin/customers/detail', customerDetail)
  .post('/api/admin/customers/note', addNote)
  .post('/api/admin/customers/points', grantPoints)
  .post('/api/admin/customers/email', emailCustomer)
  .get('/api/admin/tickets', listTickets)
  .get('/api/admin/tickets/:id', ticketDetail)
  .post('/api/admin/tickets/:id/reply', replyTicket)
  .post('/api/admin/tickets/:id/status', setTicketStatus)
  // Marketing: admin
  .get('/api/admin/marketing/campaigns', listCampaigns)
  .post('/api/admin/marketing/campaigns', createCampaign)
  .post('/api/admin/marketing/campaigns/draft', draftCampaign)
  .post('/api/admin/marketing/campaigns/:id/test', testSendCampaign)
  .post('/api/admin/marketing/campaigns/:id/send', sendCampaign)
  .get('/api/admin/marketing/flows', listFlows)
  .put('/api/admin/marketing/flows/:key', updateFlow)
  .get('/api/admin/marketing/contacts', contactStats)
  .get('/api/admin/marketing/contacts.csv', exportContacts)
  .get('/api/admin/marketing/landing-pages', listLandingPages)
  .post('/api/admin/marketing/landing-pages', upsertLandingPage)
  .get('/api/admin/marketing/promotions', listPromotions)
  .post('/api/admin/marketing/promotions', createPromotion)
  .delete('/api/admin/marketing/promotions/:id', deactivatePromotion)
  .get('/api/admin/analytics', analytics)
  .post('/api/admin/content/generate', generateContent)
  .post('/api/admin/content/lifestyle-image', generateLifestyleImage)
  .get('/api/admin/b2b/sell-sheet', sellSheet)
  .get('/api/admin/b2b/rangeme.csv', rangeMeCsv)
  .get('/api/admin/marketing/reviews/pending', pendingReviews)
  .post('/api/admin/marketing/reviews/:id', moderateReview)
  // Stripe webhooks
  .post('/api/webhooks/stripe', stripeWebhook)
  // Product images from R2
  .get('/images/*', serveImage);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // Canonical-domain redirect: the workers.dev alias 301s to the real domain
    // so search engines index exactly one origin.
    if (env.CANONICAL_HOST && url.hostname.endsWith('.workers.dev') && url.hostname !== env.CANONICAL_HOST) {
      url.hostname = env.CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }
    const matched = await router.handle(req, env, ctx);
    if (matched) return matched;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/')) {
      return errorResponse('Not found', 404);
    }
    // SEO surfaces
    if (req.method === 'GET') {
      if (url.pathname === '/robots.txt') return robotsTxt(url.origin);
      if (url.pathname === '/sitemap.xml') return sitemapXml(env, url.origin);
      if (url.pathname === '/llms.txt') return llmsTxt(env, url.origin);
    }
    // Everything else: the React SPA from static assets, with per-route
    // titles/canonical/OG/JSON-LD injected into HTML responses at the edge.
    const assetResponse = await env.ASSETS.fetch(req);
    return withPageMeta(req, env, assetResponse);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
