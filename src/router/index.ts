import { useBlockchain } from '@/stores';
import { createRouter, createWebHashHistory } from 'vue-router';
// @ts-ignore
import { setupLayouts } from 'virtual:generated-layouts';
// @ts-ignore
import routes from '~pages';

// Convert query-param deep links (?tx=HASH or ?account=ADDR) to hash routes.
// EpixNet's wrapper passes query strings through to the iframe but not hash fragments,
// so external links use ?tx= / ?account= and this converts them for Vue Router.
(function () {
  const p = new URLSearchParams(window.location.search);
  const tx = p.get('tx');
  const account = p.get('account');
  if (tx) { window.location.replace('#/tx/' + tx); }
  else if (account) { window.location.replace('#/account/' + account); }
})();

const router = createRouter({
  history: createWebHashHistory(),
  routes: setupLayouts(routes),
});

// Handle stale chunk errors after deployments by reloading the page
router.onError((error, to) => {
  if (
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Importing a module script failed')
  ) {
    window.location.href = to.fullPath;
  }
});

// Clean stale ?wallet= query param from the URL.
// The wallet/suggest page uses ?wallet=evm|consensus for tab deep-linking,
// but vue-router hash history only changes the hash portion, so ?wallet=
// persists in window.location.search when navigating to other pages.
function cleanWalletParam(targetPath: string) {
  if (!targetPath.includes('/wallet/suggest') && window.location.search.includes('wallet=')) {
    const url = new URL(window.location.href);
    url.searchParams.delete('wallet');
    // Bypass any monkey-patches on replaceState
    History.prototype.replaceState.call(history, history.state, '', url.pathname + url.search + url.hash);
  }
}

// Single-chain app: always set to epix
router.beforeEach((to) => {
  const blockchain = useBlockchain();
  if (blockchain.chainName !== 'epix') {
    blockchain.setCurrent('epix');
  }

  // Clean ?wallet= before navigation so the URL is clean when new page renders
  cleanWalletParam(to.path);

  // Close mobile menu on navigation
  window.dispatchEvent(new CustomEvent('close-mobile-menu'));
});

// Also clean after navigation in case pushState re-introduced the param
router.afterEach((to) => {
  cleanWalletParam(to.path);
});

// Docs: https://router.vuejs.org/guide/advanced/navigation-guards.html#global-before-guards

export default router;
