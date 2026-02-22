<script lang="ts" setup>
import { CosmosRestClient } from '@/libs/client';
import { useBlockchain, useDashboard, useFormatter } from '@/stores';
import { formatSmallPrice } from '@/stores/useFormatter';
import type { CoinWithPrice, Delegation } from '@/types';
import { fromBech32, toBase64 } from '@cosmjs/encoding';
import { Icon } from '@iconify/vue';
import { computed, ref } from 'vue';
import {
  scanLocalKeys,
  type AccountEntry,
  scanCompatibleAccounts,
  type LocalKey,
} from './utils';
import AdBanner from '@/components/ad/AdBanner.vue';

const dashboard = useDashboard();
const chainStore = useBlockchain();
const format = useFormatter();
const sourceAddress = ref(''); //
const sourceHdPath = ref(chainStore.defaultHDPath); //
const selectedSource = ref({} as LocalKey); //
const importStep = ref('step1');

const conf = ref(JSON.parse(localStorage.getItem('imported-addresses') || '{}') as Record<string, AccountEntry[]>);
const balances = ref({} as Record<string, CoinWithPrice[]>);
const delegations = ref({} as Record<string, Delegation[]>);

// initial loading queue
// load balances
Object.values(conf.value).forEach((imported) => {
  let promise = Promise.resolve();
  for (let i = 0; i < imported.length; i++) {
    promise = promise.then(
      () =>
        new Promise((resolve) => {
          // continue only if the page is living
          if (imported[i].endpoint) {
            loadBalances(imported[i].chainName, imported[i].endpoint || '', imported[i].address).finally(() =>
              resolve()
            );
          } else {
            resolve();
          }
        })
    );
  }
});

const accounts = computed(() => {
  let a = [] as {
    key: string;
    subaccounts: {
      account: AccountEntry;
      delegation: CoinWithPrice;
      balances: CoinWithPrice[];
    }[];
  }[];
  Object.values(conf.value).forEach((x) => {
    const composition = x.map((entry) => {
      const d = delegations.value[entry.address];
      let delegation = {} as CoinWithPrice;
      if (d && d.length > 0) {
        d.forEach((b) => {
          delegation.amount = (Number(b.balance.amount) + Number(delegation.amount || 0)).toFixed();
          delegation.denom = b.balance.denom;
        });
        delegation.value = format.tokenValueNumber(delegation);
        delegation.change24h = format.priceChanges(delegation.denom);
      }
      return {
        account: entry,
        delegation,
        balances: balances.value[entry.address]
          ? balances.value[entry.address].map((x) => {
              const value = format.tokenValueNumber(x);
              return {
                amount: x.amount,
                denom: x.denom,
                value,
                change24h: format.priceChanges(x.denom),
              };
            })
          : [],
      };
    });
    if (x.at(0)) a.push({ key: x.at(0)?.address || ' ', subaccounts: composition });
  });
  return a;
});

const addresses = computed(() => {
  return accounts.value.flatMap((x) => x.subaccounts.map((a) => a.account.address));
});

const totalValue = computed(() => {
  return accounts.value
    .flatMap((x) => x.subaccounts)
    .reduce((s, e) => {
      s += e.delegation.value || 0;
      e.balances.forEach((b) => {
        s += b.value || 0;
      });
      return s;
    }, 0);
});

const totalChange = computed(() => {
  return accounts.value
    .flatMap((x) => x.subaccounts)
    .reduce((s, e) => {
      s += ((e.delegation.change24h || 0) * (e.delegation.value || 0)) / 100;
      e.balances.forEach((b) => {
        s += ((b.change24h || 0) * (b.value || 0)) / 100;
      });
      return s;
    }, 0);
});

// Adding Model Boxes
const availableAccount = computed(() => {
  if (sourceAddress.value) {
    return scanCompatibleAccounts([{ cosmosAddress: sourceAddress.value, hdPath: sourceHdPath.value }]).filter(
      (x) => !addresses.value.includes(x.address)
    );
  }
  return [];
});

// helper functions
// remove address from the list
function removeAddress(addr: string) {
  const newConf = {} as Record<string, AccountEntry[]>;
  Object.keys(conf.value).forEach((key) => {
    const acc = conf.value[key].filter((x) => x.address !== addr);
    if (acc.length > 0) newConf[key] = acc;
  });
  conf.value = newConf;
  localStorage.setItem('imported-addresses', JSON.stringify(conf.value));
}

// add address to the local list
async function addAddress(acc: AccountEntry) {
  const { data } = fromBech32(acc.address);
  const key = toBase64(data);

  if (conf.value[key]) {
    // existed
    if (conf.value[key].findIndex((x) => x.address === acc.address) > -1) {
      return;
    }
    conf.value[key].push(acc);
  } else {
    conf.value[key] = [acc];
  }

  // also add chain to favorite
  if (!dashboard?.favoriteMap?.[acc.chainName]) {
    dashboard.favoriteMap[acc.chainName] = true;
    window.localStorage.setItem('favoriteMap', JSON.stringify(dashboard.favoriteMap));
  }

  if (acc.endpoint) {
    loadBalances(acc.chainName, acc.endpoint, acc.address);
  }

  localStorage.setItem('imported-addresses', JSON.stringify(conf.value));
}

// load balances for an address
async function loadBalances(chainName: string, endpoint: string, address: string) {
  const endpointObj = chainStore.randomEndpoint(chainName);
  const client = CosmosRestClient.newDefault(endpointObj?.address || endpoint);
  await client.getBankBalances(address).then((res) => {
    balances.value[address] = res.balances.filter((x) => x.denom.length < 10);
  });
  await client.getStakingDelegations(address).then((res) => {
    delegations.value[address] = res.delegation_responses;
  });
}
</script>
<template>
  <div>
    <div class="overflow-x-auto w-full rounded-md">
      <div class="modern-card shadow-modern p-6 mb-6">
        <div class="flex flex-wrap justify-between items-start">
          <div class="min-w-0">
            <h2 class="text-2xl font-bold leading-7 sm:!truncate sm:!text-3xl sm:!tracking-tight text-gray-900 dark:text-white">
              Accounts
            </h2>
            <div class="mt-1 flex flex-col sm:!mt-0 sm:!flex-row sm:!flex-wrap sm:!space-x-6">
              <div class="mt-2 items-center text-sm text-gray-600 dark:text-gray-400 hidden md:!flex">
                <Icon icon="mdi:wallet" class="mr-1.5 h-5 w-5 flex-shrink-0 text-epix-primary" />
                Manage all your assets in one page
              </div>
            </div>
          </div>
          <div class="flex flex-col text-right">
            <span class="text-sm text-gray-600 dark:text-gray-400">Total Value</span>
            <span class="text-2xl font-bold text-green-500">${{ formatSmallPrice(totalValue) }}</span>
            <span class="text-sm" :class="format.color(totalChange)">{{ totalChange >= 0 ? '+' : '' }}{{ formatSmallPrice(totalChange) }}</span>
          </div>
        </div>
      </div>
    </div>

    <AdBanner
      id="account-banner-ad"
      unit="banner"
      width="970px"
      height="90px"
    />

    <div class="overflow-x-auto">
      <div v-for="{ key, subaccounts } in accounts" class="modern-card shadow-modern my-6 p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-epix-primary flex items-center justify-center">
              <Icon icon="mdi:wallet" class="text-white text-xl" />
            </div>
            <div>
              <div class="font-bold text-gray-900 dark:text-white text-lg truncate max-w-md">{{ key }}</div>
              <div class="dropdown">
                <div class="cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-epix-primary transition-colors duration-200">
                  {{ subaccounts.length }} addresses
                </div>
                <ul class="dropdown-content menu p-2 shadow-modern bg-white dark:bg-epix-gray rounded-lg z-50 w-80 -left-14">
                  <li v-for="x in subaccounts" :key="x.account.address">
                    <div class="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-epix-gray-light rounded-lg">
                      <div class="flex items-center gap-3">
                        <img :src="x.account.logo" class="w-8 h-8 rounded-full" />
                        <div>
                          <div class="font-bold capitalize text-gray-900 dark:text-white">{{ x.account.chainName }}</div>
                          <div class="text-xs text-gray-600 dark:text-gray-400 font-mono truncate max-w-32">{{ x.account.address }}</div>
                        </div>
                      </div>
                      <button class="modern-button-secondary !text-xs px-3 py-1" @click="removeAddress(x.account.address)">
                        <Icon icon="mdi:delete" class="mr-1" />
                        Remove
                      </button>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        <!-- Delegations Section -->
        <div class="mb-6">
          <div class="flex items-center gap-2 mb-4 p-3 bg-gray-50 dark:bg-epix-gray rounded-lg">
            <Icon icon="mdi:hand-coin" class="text-epix-primary text-lg" />
            <h3 class="font-semibold text-gray-900 dark:text-white">Delegations</h3>
          </div>
          <div class="space-y-2">
            <div v-for="x in subaccounts" :key="x.account.address">
              <RouterLink
                v-if="x.delegation.amount"
                :to="`/${x.account.chainName}/account/${x.account.address}`"
                class="flex items-center justify-between p-4 bg-white dark:bg-epix-gray rounded-lg hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200 border border-gray-200 dark:border-gray-700"
              >
                <div class="flex items-center gap-3">
                  <img :src="x.account.logo" :alt="x.account.chainName" class="w-8 h-8 rounded-full" />
                  <div>
                    <div class="font-bold text-gray-900 dark:text-white">{{ format.formatToken(x.delegation, true, '0,0.[00]', 'all') }}</div>
                    <div class="text-xs" :class="format.color(x.delegation.change24h)">
                      {{ format.formatNumber(x.delegation.change24h, '+0.[00]') }}%
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="font-bold text-gray-900 dark:text-white">${{ formatSmallPrice(x.delegation.value || 0) }}</div>
                  <div class="text-xs" :class="format.color(x.delegation.change24h)">
                    {{ ((x.delegation.change24h || 0) * (x.delegation.value || 0) / 100) >= 0 ? '+' : '' }}{{ formatSmallPrice((x.delegation.change24h || 0) * (x.delegation.value || 0) / 100) }}
                  </div>
                </div>
              </RouterLink>
            </div>
          </div>
        </div>

        <!-- Balances Section -->
        <div class="mb-6">
          <div class="flex items-center gap-2 mb-4 p-3 bg-gray-50 dark:bg-epix-gray rounded-lg">
            <Icon icon="mdi:coins" class="text-epix-primary text-lg" />
            <h3 class="font-semibold text-gray-900 dark:text-white">Balances</h3>
          </div>
          <div class="space-y-2">
            <div v-for="s in subaccounts" :key="s.account.address">
              <RouterLink
                v-for="x in s.balances"
                :key="`${s.account.address}-${x.denom}`"
                :to="`/${s.account.chainName}/account/${s.account.address}`"
                class="flex items-center justify-between p-4 bg-white dark:bg-epix-gray rounded-lg hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200 border border-gray-200 dark:border-gray-700"
              >
                <div class="flex items-center gap-3">
                  <img :src="s.account.logo" :alt="s.account.chainName" class="w-8 h-8 rounded-full" />
                  <div>
                    <div class="font-bold text-gray-900 dark:text-white">{{ format.formatToken(x, true, '0,0.[00]', 'all') }}</div>
                    <div class="text-xs" :class="format.color(x.change24h)">
                      {{ format.formatNumber(x.change24h, '+0.[00]') }}%
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="font-bold text-gray-900 dark:text-white">${{ formatSmallPrice(x.value || 0) }}</div>
                  <div class="text-xs" :class="format.color(x.change24h)">
                    {{ ((x.change24h || 0) * (x.value || 0) / 100) >= 0 ? '+' : '' }}{{ formatSmallPrice((x.change24h || 0) * (x.value || 0) / 100) }}
                  </div>
                </div>
              </RouterLink>
            </div>
          </div>
        </div>
      </div>

      <div class="text-center modern-card shadow-modern my-6 p-6">
        <a href="#address-modal"
          class="modern-button inline-flex items-center gap-2">
          <Icon icon="mdi:plus" class="text-lg" />
          Import Address
        </a>
      </div>
    </div>
    <!-- Import Address Modal -->
    <div class="modal" id="address-modal">
      <div class="modal-box modern-card shadow-modern max-w-2xl">
        <a href="#" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2 hover:bg-gray-100 dark:hover:bg-gray-800">&#x2715;</a>
        <h3 class="font-bold text-xl mb-4 text-gray-900 dark:text-white">Derive Account From Address</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Address</label>
            <input
              v-model="sourceAddress"
              class="modern-input w-full p-3"
              placeholder="Input an address"
              @change="importStep = 'step2'"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">HD Path</label>
            <input
              v-model="sourceHdPath"
              class="modern-input w-full p-3"
              :placeholder="chainStore.defaultHDPath"
            />
          </div>
        </div>
        <div v-show="importStep === 'step2'" class="py-6 max-h-72 overflow-y-auto">
          <h4 class="font-semibold text-gray-900 dark:text-white mb-4">Available Accounts</h4>
          <div class="space-y-3">
            <div v-for="acc in availableAccount" :key="acc.address"
                 class="flex items-center justify-between p-4 bg-gray-50 dark:bg-epix-gray rounded-lg border border-gray-200 dark:border-gray-700">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full overflow-hidden">
                  <img :src="acc.logo" :alt="acc.chainName" class="w-full h-full object-cover" />
                </div>
                <div>
                  <div class="tooltip" :class="acc.compatiable ? 'tooltip-success' : 'tooltip-error'"
                       :data-tip="`Coin Type: ${acc.coinType}`">
                    <div class="font-bold capitalize" :class="acc.compatiable ? 'text-green-500' : 'text-red-500'">
                      {{ acc.chainName }}
                    </div>
                  </div>
                  <div class="text-xs text-gray-600 dark:text-gray-400 font-mono truncate max-w-48">
                    {{ acc.address }}
                  </div>
                </div>
              </div>
              <button class="modern-button !text-xs px-3 py-2" @click="addAddress(acc)">
                <Icon icon="mdi:plus" class="mr-1" />
                Add
              </button>
            </div>
          </div>
        </div>
        <div class="modal-action mt-6 mb-0">
          <a href="#" class="modern-button-secondary px-6 py-2" @click="importStep = 'step1'">Close</a>
        </div>
      </div>
    </div>
  </div>
</template>
