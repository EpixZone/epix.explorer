import {
  useBlockchain,
  useCoingecko,
  useBaseStore,
  useBankStore,
  useFormatter,
  useGovStore,
  useDistributionStore,
  useMintStore,
  useStakingStore,
} from '@/stores';
import type { Coin, Tally } from '@/types';
import numeral from 'numeral';
import { defineStore } from 'pinia';

export function colorMap(color: string) {
  switch (color) {
    case 'yellow':
      return 'warning';
    case 'green':
      return 'success';
    default:
      return 'secondary';
  }
}

const CODEMAP: Record<string, string[]> = {
  'binance.com': ['ref', 'CPA_004JZGRX6A'],
  'gate.com': ['ref', 'U1gVBl9a'],
  bybit: ['affiliate_id', 'JKRRZX9'],
};

export const useIndexModule = defineStore('module-index', {
  state: () => {
    return {
      days: 7,
      chartLoading: false,
      tickerIndex: 0,
      coinInfo: {
        name: '',
        symbol: '',
        description: {
          en: '',
        },
        categories: [] as string[],
        market_cap_rank: 0,
        links: {
          twitter_screen_name: '',
          homepage: [] as string[],
          repos_url: {
            github: [],
          },
          telegram_channel_identifier: '',
        },
        market_data: {
          price_change_percentage_24h: 0,
        },
        tickers: [] as {
          market: {
            name: string;
            identifier: string;
          };
          coin_id: string;
          target_coin_id: string;
          trust_score: string;
          trade_url: string;
          converted_last: {
            btc: number;
            eth: number;
            usd: number;
          };
          base: string;
          target: string;
        }[],
      },
      marketData: {
        market_caps: [],
        prices: [] as number[],
        total_volumes: [] as number[],
      },
      communityPool: [] as { amount: string; denom: string }[],
      tally: {} as Record<string, Tally>,
    };
  },
  getters: {
    blockchain() {
      const chain = useBlockchain();
      return chain.current;
    },
    coingecko() {
      return useCoingecko();
    },
    bankStore() {
      return useBankStore();
    },
    twitter(): string {
      if (!this.coinInfo?.links?.twitter_screen_name) return '';
      return `https://twitter.com/${this.coinInfo?.links.twitter_screen_name}`;
    },
    homepage(): string {
      if (!this.coinInfo?.links?.homepage) return '';
      const [page1, page2, page3] = this.coinInfo?.links?.homepage;
      return page1 || page2 || page3;
    },
    github(): string {
      if (!this.coinInfo?.links?.repos_url) return '';
      const [page1, page2, page3] = this.coinInfo?.links?.repos_url?.github;
      return page1 || page2 || page3;
    },
    telegram(): string {
      if (!this.coinInfo?.links?.homepage) return '';
      return `https://t.me/${this.coinInfo?.links.telegram_channel_identifier}`;
    },

    priceChange(): string {
      if (!this.coinInfo?.market_data?.price_change_percentage_24h) return '';
      const change = this.coinInfo?.market_data?.price_change_percentage_24h || 0;
      return numeral(change).format('+0.[00]');
    },

    priceColor(): string {
      if (!this.coinInfo?.market_data?.price_change_percentage_24h) return '';
      const change = this.coinInfo?.market_data?.price_change_percentage_24h || 0;
      switch (true) {
        case change > 0:
          return 'text-success';
        case change < 0:
          return 'text-error';
        default:
          return '';
      }
    },
    trustColor(): string {
      if (!this.coinInfo?.tickers) return '';
      const change = this.coinInfo?.tickers[this.tickerIndex]?.trust_score;
      return change;
    },

    pool() {
      const staking = useStakingStore();
      return staking.pool;
    },

    proposals() {
      const gov = useGovStore();
      return gov.proposals['2'];
    },

    stats() {
      const base = useBaseStore();
      const bank = useBankStore();
      const staking = useStakingStore();
      const mintStore = useMintStore();
      const formatter = useFormatter();

      return [
        {
          title: 'Height',
          color: 'primary',
          icon: 'mdi-pound',
          stats: formatter.formatNumber(Number(base?.latest?.block?.header?.height || 0), '0,0'),
          change: 0,
          subtitle: 'Latest Block'
        },
        {
          title: 'Validators',
          color: 'error',
          icon: 'mdi-human-queue',
          stats: String(base?.latest?.block?.last_commit?.signatures.length || 0),
          change: 0,
          subtitle: 'Active Validators'
        },
        {
          title: 'Supply',
          color: 'success',
          icon: 'mdi-currency-usd',
          stats: formatter.formatToken(bank.supply, false, '0.0a'),
          change: 0,
          subtitle: formatter.tokenDisplayDenom(bank.supply?.denom)?.toUpperCase() || 'EPIX'
        },
        {
          title: 'Bonded Tokens',
          color: 'warning',
          icon: 'mdi-lock',
          stats: formatter.formatToken({
            // @ts-ignore
            amount: this.pool.bonded_tokens,
            denom: staking.params.bond_denom,
          }, false, '0.0a'),
          change: 0,
          subtitle: `${formatter.calculateBondedRatio(this.pool)} Bonded`
        },
        {
          title: 'Inflation',
          color: 'success',
          icon: 'mdi-chart-multiple',
          stats: formatter.formatDecimalToPercent(mintStore.inflation),
          change: 0,
          subtitle: 'Annual Rate'
        },
        {
          title: 'Community Pool',
          color: 'primary',
          icon: 'mdi-bank',
          stats: formatter.formatToken(
            // @ts-ignore
            this.communityPool?.find(
              (x: Coin) => x.denom === staking.params.bond_denom
            ), false, '0.0a'
          ),
          change: 0,
          subtitle: formatter.tokenDisplayDenom(staking.params.bond_denom)?.toUpperCase() || 'EPIX'
        },
      ];
    },

    coingeckoId() {
      this.tickerIndex = 0;
      // @ts-ignore
      const [firstAsset] = this.blockchain?.assets || [];
      if (!firstAsset) return '';
      if (firstAsset.coingecko_id && firstAsset.coingecko_id !== 'unknown') {
        return firstAsset.coingecko_id;
      }
      if ((firstAsset as any).osmosis_symbol) {
        return `osmosis-${(firstAsset as any).osmosis_symbol.toLowerCase()}`;
      }
      return '';
    },
  },
  actions: {
    async loadDashboard() {
      this.tickerIndex = 0;
      this.coinInfo = {
        name: '',
        symbol: '',
        description: { en: '' },
        categories: [],
        market_cap_rank: 0,
        links: {
          twitter_screen_name: '',
          homepage: [],
          repos_url: { github: [] },
          telegram_channel_identifier: '',
        },
        market_data: { price_change_percentage_24h: 0 },
        tickers: [],
      };
      this.marketData = { market_caps: [], prices: [], total_volumes: [] };
      this.communityPool = [];
      this.tally = {};
      this.initCoingecko();
      useMintStore().fetchInflation();
      useDistributionStore()
        .fetchCommunityPool()
        .then((x) => {
          this.communityPool = x?.pool
            ?.filter((t) => t.denom.length < 10)
            ?.map((t) => ({
              amount: String(parseInt(t.amount)),
              denom: t.denom,
            }));
        });
      // const gov = useGovStore();
      // gov.fetchProposals('2').then((x) => {
      //   this.proposals = x;
      // });
    },
    tickerColor(color: string) {
      return colorMap(color);
    },
    initCoingecko() {
      this.tickerIndex = 0;
      const [firstAsset] = this.blockchain?.assets || [];
      if (!firstAsset) return;

      const osmosisSymbol = (firstAsset as any).osmosis_symbol;
      const osmosisIbc = (firstAsset as any).osmosis_ibc;

      if (firstAsset.coingecko_id && firstAsset.coingecko_id !== 'unknown') {
        this.coingecko.getCoinInfo(firstAsset.coingecko_id).then((x) => {
          this.coinInfo = x;
        });
        this.fetchChartData();
      } else if (osmosisSymbol) {
        this.coingecko.getOsmosisTokenInfo(osmosisSymbol).then((tokenData) => {
          if (tokenData) {
            this.coinInfo = {
              name: useBlockchain().current?.prettyName || firstAsset.display || firstAsset.symbol,
              symbol: firstAsset.symbol,
              description: { en: '' },
              categories: [],
              market_cap_rank: 0,
              links: {
                twitter_screen_name: '',
                homepage: [],
                repos_url: { github: [] },
                telegram_channel_identifier: '',
              },
              market_data: {
                price_change_percentage_24h: tokenData.price_24h_change || 0,
              },
              tickers: [{
                market: { name: 'Osmosis DEX', identifier: 'osmosis' },
                coin_id: osmosisSymbol.toLowerCase(),
                target_coin_id: 'usd',
                trust_score: 'green',
                trade_url: `https://app.osmosis.zone/?from=USDC&to=${osmosisIbc || osmosisSymbol}`,
                converted_last: { btc: 0, eth: 0, usd: tokenData.price || 0 },
                base: osmosisSymbol,
                target: 'USD',
              }],
            };
          }
        });

        this.fetchChartData();
      }
    },
    fetchChartData() {
      const [firstAsset] = this.blockchain?.assets || [];
      if (!firstAsset) return;
      const osmosisSymbol = (firstAsset as any).osmosis_symbol;
      this.chartLoading = true;

      if (firstAsset.coingecko_id && firstAsset.coingecko_id !== 'unknown') {
        this.coingecko
          .getMarketChart(this.days, firstAsset.coingecko_id)
          .then((x) => {
            this.marketData = x;
          })
          .finally(() => { this.chartLoading = false; });
      } else if (osmosisSymbol) {
        // Map days to Osmosis tf (minutes): pick a resolution that gives a reasonable number of data points
        let tf = 60;
        if (this.days <= 1/24) tf = 5;        // 1H -> 5min candles
        else if (this.days <= 1) tf = 15;      // 1D -> 15min candles
        else if (this.days <= 7) tf = 60;      // 7D -> 1h candles
        else if (this.days <= 30) tf = 240;    // 30D -> 4h candles
        else if (this.days <= 365) tf = 1440;  // 1Y -> 1d candles
        else tf = 10080;                        // ALL -> 1w candles

        this.coingecko.getOsmosisMarketChart(osmosisSymbol, tf).then((x: any) => {
          // Filter data to the requested time window (Osmosis API returns full history)
          if (this.days < 9999) {
            const cutoff = Date.now() - this.days * 24 * 60 * 60 * 1000;
            x.prices = x.prices.filter((p: any) => p[0] >= cutoff);
            x.total_volumes = x.total_volumes.filter((p: any) => p[0] >= cutoff);
          }
          this.marketData = x;
        }).finally(() => { this.chartLoading = false; });
      } else {
        this.chartLoading = false;
      }
    },
    setTimeframe(days: number) {
      this.days = days;
      this.marketData = { market_caps: [], prices: [], total_volumes: [] };
      this.fetchChartData();
    },
    selectTicker(i: number) {
      this.tickerIndex = i;
    },
  },
});

/**
 * Adds or replaces a query parameter in the provided URL.
 * @param url - The base URL.
 * @param param - The name of the parameter to add or replace.
 * @param value - The value to set for the parameter.
 * @returns The new URL with the parameter added or replaced.
 */
export function addOrReplaceUrlParam(url: string, param: string, value: string): string {
  // Parse the URL
  const urlObj = new URL(url, window.location.origin);

  // Set (add or replace) the query parameter
  urlObj.searchParams.set(param, value);

  // Return the string representation of the new URL
  return urlObj.toString();
}

export function tickerUrl(url: string) {
  for (const domain of Object.keys(CODEMAP)) {
    if (url.indexOf(domain) > -1) {
      const v = CODEMAP[domain];
      return addOrReplaceUrlParam(url, v[0], v[1]);
    }
  }
  return url;
}
