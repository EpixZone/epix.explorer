import { defineStore } from 'pinia';
import { get } from '@/libs/http';
import type { LoadingStatus } from '@/stores';

export interface PriceMeta {
  usd?: string;
  usd_24h_change?: string;
  cny?: string;
  cny_24h_change?: string;
  eur?: string;
  eur_24h_change?: string;
}

const LocalStoreKey = 'currency';

export const coingeckoUrl = import.meta.env.VITE_COINGECKO_URL || 'https://api.coingecko.com';

// A usable CoinGecko id from the chain config ('unknown' and junk are ignored).
export function validCoingeckoId(id: unknown): string {
  return typeof id === 'string' && id !== 'unknown' && /^[a-z0-9-]{1,64}$/.test(id) ? id : '';
}

// The id to ask CoinGecko for when Osmosis has no price for a token: the chain
// config's coingecko_id, or the id Osmosis itself reports for the token.
export function coingeckoFallbackId(configId: unknown, tokens?: any[]): string {
  const reported = Array.isArray(tokens) ? tokens.find((t) => t && t.coingecko_id)?.coingecko_id : '';
  return validCoingeckoId(configId) || validCoingeckoId(reported);
}

export const useCoingecko = defineStore('coingecko', {
  state: () => {
    const currency = localStorage.getItem(LocalStoreKey);
    return {
      currency, // secondary currency
      loadStatus: {} as Record<string, LoadingStatus | undefined>,
      prices: {} as Record<string, PriceMeta>,
      marketChart: {},
    };
  },
  getters: {},

  actions: {
    getMarketChart(days = 30, coinId = 'cosmos') {
      return get(`${coingeckoUrl}/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`);
    },

    fetchCoinPrice(ids: string[]) {
      const url = `${coingeckoUrl}/api/v3/simple/price?include_24hr_change=true&vs_currencies=${[
        'usd',
        this.currency,
      ].join(',')}&ids=${ids.join(',')}`;
      get(url).then((data) => {
        this.prices = { ...this.prices, ...data };
      });
    },
    getCoinInfo(coinId: string) {
      return get(`${coingeckoUrl}/api/v3/coins/${coinId}`);
    },
    // Spot price with 24h change for one coin; the fallback when the Osmosis
    // feed reports no price. Resolves to null when CoinGecko has no quote.
    getSimplePrice(coinId: string): Promise<{ usd: number; usd_24h_change: number } | null> {
      return get(`${coingeckoUrl}/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`).then((data: any) => {
        const row = data?.[coinId];
        if (!row || row.usd == null) return null;
        return { usd: Number(row.usd), usd_24h_change: Number(row.usd_24h_change ?? 0) };
      });
    },
    setSecondaryCurrency(currency: string) {
      if (currency !== 'usd') {
        localStorage.setItem(LocalStoreKey, currency);
        this.currency = currency;
      }
    },
    getOsmosisTokenInfo(symbol: string) {
      return get(`https://data.app.osmosis.zone/tokens/v2/${symbol}`).then((data: any[]) => {
        if (!data || data.length === 0) return null;
        return data.find(d => d && d.price != null) || data[0];
      });
    },
    getOsmosisMarketChart(symbol: string, tf = 60) {
      return get(`https://data.app.osmosis.zone/tokens/v2/historical/${symbol}/chart?tf=${tf}`).then((data: any[]) => {
        if (!data || !Array.isArray(data)) return { prices: [], total_volumes: [], market_caps: [] };
        const prices = data.map(d => [d.time * 1000, d.close]);
        const total_volumes = data.map(d => [d.time * 1000, d.volume]);
        const market_caps: any[] = [];
        return { prices, total_volumes, market_caps };
      });
    },
  },
});
