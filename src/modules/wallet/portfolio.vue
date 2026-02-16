<script lang="ts" setup>
import { CosmosRestClient } from '@/libs/client';
import type { Coin, Delegation } from '@/types';
import { ref, computed } from 'vue';
import type { AccountEntry } from './utils';
import { useDashboard, useBlockchain, useFormatter } from '@/stores';
import { formatSmallPrice } from '@/stores/useFormatter';
import { Icon } from '@iconify/vue';
import DonutChart from '@/components/charts/DonutChart.vue';
import AdBanner from '@/components/ad/AdBanner.vue';

const format = useFormatter();
const dashboard = useDashboard();
const conf = ref(JSON.parse(localStorage.getItem('imported-addresses') || '{}') as Record<string, AccountEntry[]>);
const chainStore = useBlockchain();
const balances = ref({} as Record<string, Coin[]>);
const delegations = ref({} as Record<string, Delegation[]>);
const tokenMeta = ref({} as Record<string, AccountEntry>);

Object.values(conf.value).forEach((imported) => {
  if (imported)
    imported.forEach((x) => {
      if (x.endpoint && x.address) {
        const endpoint = chainStore.randomEndpoint(x.chainName);
        const client = CosmosRestClient.newDefault(endpoint?.address || x.endpoint);
        client
          .getBankBalances(x.address)
          .then((res) => {
            const bal = res.balances.filter((x) => x.denom.length < 10);
            if (bal) balances.value[x.address || ''] = bal;
            bal.forEach((b) => {
              tokenMeta.value[b.denom] = x;
            });
          });
        client.getStakingDelegations(x.address).then((res) => {
          if (res && res.delegation_responses) delegations.value[x.address || ''] = res.delegation_responses;
          res.delegation_responses.forEach((del) => {
            tokenMeta.value[del.balance.denom] = x;
          });
        });
      }
    });
});

const tokenQty = computed(() => {
  const values = {} as Record<string, number>;
  Object.values(balances.value).forEach((b) => {
    b.forEach((coin) => {
      const v = format.tokenDisplayNumber(coin);
      if (v) {
        values[coin.denom] = (values[coin.denom] || 0) + v;
      }
    });
  });
  Object.values(delegations.value).forEach((b) => {
    b.forEach((d) => {
      const v = format.tokenDisplayNumber(d.balance);
      if (v) {
        values[d.balance.denom] = (values[d.balance.denom] || 0) + v;
      }
    });
  });
  return values;
});

const tokenValues = computed(() => {
  // Access dashboard.prices to ensure reactivity when prices load
  const _ = dashboard.prices;
  const values = {} as Record<string, number>;
  Object.keys(tokenQty.value).forEach((denom) => {
    const qty = tokenQty.value[denom];
    const unitPrice = format.price(denom);
    values[denom] = qty * unitPrice;
  });
  return values;
});

const totalValue = computed(() => {
  return Object.values(tokenValues.value).reduce((a, s) => a + s, 0);
});

const tokenList = computed(() => {
  const list = [] as {
    denom: string;
    qty: number;
    value: number;
    logo: string;
    chainName: string;
    percentage: number;
  }[];
  Object.keys(tokenQty.value).map((denom) => {
    list.push({
      denom,
      qty: tokenQty.value[denom],
      value: tokenValues.value[denom] || 0,
      chainName: tokenMeta.value[denom]?.chainName,
      logo: tokenMeta.value[denom]?.logo,
      percentage: totalValue.value > 0 ? (tokenValues.value[denom] || 0) / totalValue.value : 0,
    });
  });
  return list.filter((x) => x.qty > 0).sort((a, b) => b.value - a.value);
});

const totalChangeIn24 = computed(() => {
  const _ = dashboard.prices;
  return Object.keys(tokenQty.value)
    .map((denom) => {
      const qty = tokenQty.value[denom];
      const change = format.priceChanges(denom);
      const unitPrice = format.price(denom);
      // Convert percentage change to absolute change
      return unitPrice > 0 && change ? qty * unitPrice * (change / 100) : 0;
    })
    .reduce((s, c) => s + c, 0);
});
</script>
<template>
  <div class="overflow-x-auto w-full rounded-md">

    <div class="modern-card shadow-modern p-6 mb-6">
      <div class="flex flex-wrap justify-between items-start">
        <div class="min-w-0">
          <h2 class="text-2xl font-bold leading-7 sm:!truncate sm:!text-3xl sm:!tracking-tight text-gray-900 dark:text-white">
            Portfolio
          </h2>
        </div>
        <div class="text-right">
          <div class="text-sm text-gray-600 dark:text-gray-400">Total Value</div>
          <div class="text-2xl font-bold text-green-500">${{ formatSmallPrice(totalValue) }}</div>
          <div class="text-sm" :class="{ 'text-green-500': totalChangeIn24 > 0, 'text-red-500': totalChangeIn24 < 0 }">
            {{ totalChangeIn24 >= 0 ? '+' : '' }}{{ formatSmallPrice(totalChangeIn24) }}
          </div>
        </div>
      </div>
    </div>
    <div class="modern-card shadow-modern p-6 mb-6">
      <div v-if="tokenList.length > 0" class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-white dark:bg-epix-gray rounded-lg p-4">
          <DonutChart height="280" :series="Object.values(tokenValues)"
            :labels="Object.keys(tokenValues).map(x => format.tokenDisplayDenom(x)?.toUpperCase())" />
        </div>
      </div>

      <AdBanner class="my-6" id="portfolio-banner-ad" unit="banner" width="970px" height="90px" />

      <div class="overflow-x-auto mt-6">
        <div class="bg-white dark:bg-epix-gray rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          <div class="bg-gray-50 dark:bg-epix-gray-light px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Token Holdings</h3>
          </div>
          <div class="divide-y divide-gray-200 dark:divide-gray-700">
            <div v-for="(x, index) in tokenList" :key="index"
                 class="flex items-center justify-between p-6 hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200">
              <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full overflow-hidden">
                  <img :src="x.logo" :alt="x.chainName" class="w-full h-full object-cover" />
                </div>
                <div>
                  <div class="font-bold text-lg text-gray-900 dark:text-white uppercase">
                    {{ format.tokenDisplayDenom(x.denom) }}
                  </div>
                  <div class="text-sm text-gray-600 dark:text-gray-400">
                    {{ format.formatNumber(x.qty, '0,0.[0000]') }} {{ format.tokenDisplayDenom(x.denom)?.toUpperCase() }}
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="font-bold text-lg text-gray-900 dark:text-white">
                  ${{ formatSmallPrice(x.value) }}
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-400">
                  {{ format.percent(x.percentage) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="p-8 text-center text-gray-600 dark:text-gray-400" v-if="tokenList.length === 0">
        <Icon icon="mdi:chart-pie" class="text-4xl mb-2 text-gray-400" />
        <div>No portfolio data available</div>
      </div>
    </div>
    <div class="text-center modern-card shadow-modern my-6 p-6">
      <RouterLink to="./accounts" class="modern-button inline-flex items-center gap-2">
        <Icon icon="mdi:plus" class="text-lg" />
        Add More Assets
      </RouterLink>
    </div>
  </div>
</template>
