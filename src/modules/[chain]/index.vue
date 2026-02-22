<script lang="ts" setup>
import MdEditor from 'md-editor-v3';
import PriceMarketChart from '@/components/charts/PriceMarketChart.vue';

import { Icon } from '@iconify/vue';
import {
  useBlockchain,
  useFormatter,
  useTxDialog,
  useWalletStore,
  useStakingStore,
  useParamStore,
} from '@/stores';
import { formatSmallPrice } from '@/stores/useFormatter';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useIndexModule, colorMap, tickerUrl } from './indexStore';

import CardStatisticsVertical from '@/components/CardStatisticsVertical.vue';
import ProposalListItem from '@/components/ProposalListItem.vue';
import ArrayObjectElement from '@/components/dynamic/ArrayObjectElement.vue';

const props = defineProps(['chain']);

const blockchain = useBlockchain();
const store = useIndexModule();
const walletStore = useWalletStore();
const format = useFormatter();
const dialog = useTxDialog();
const stakingStore = useStakingStore();
const paramStore = useParamStore();
const coinInfo = computed(() => {
  return store.coinInfo;
});

onMounted(() => {
  store.loadDashboard();
  walletStore.loadMyAsset();
  paramStore.handleAbciInfo();
});
const ticker = computed(() => store.coinInfo.tickers?.[store.tickerIndex]);

const currName = ref(blockchain.chainName)
let isActive = true;
const unsubscribe = blockchain.$subscribe((m, s) => {
  if (!isActive) return;
  if (s.chainName !== currName.value) {
    currName.value = s.chainName;
    store.loadDashboard();
    walletStore.loadMyAsset();
    paramStore.handleAbciInfo();
  }
});
onUnmounted(() => {
  isActive = false;
  unsubscribe();
});
function shortName(name: string, id: string) {
  return name.toLowerCase().startsWith('ibc/') || name.toLowerCase().startsWith('0x') ? id : name;
}

function formatPrice(value: number | undefined): string {
  if (value == null) return '0';
  return formatSmallPrice(value);
}

// wallet box
const change = computed(() => {
  const token = walletStore.balanceOfStakingToken;
  return token ? format.priceChanges(token.denom) : 0;
});
const color = computed(() => {
  switch (true) {
    case change.value > 0:
      return 'text-green-600';
    case change.value === 0:
      return 'text-grey-500';
    case change.value < 0:
      return 'text-red-600';
  }
});

function updateState() {
  walletStore.loadMyAsset();
}

function trustColor(v: string) {
  return `text-${colorMap(v)}`;
}

const marketCap = computed(() => {
  const price = ticker.value?.converted_last?.usd || 0;
  const supplyAmount = format.tokenDisplayNumber(store.bankStore.supply);
  return price * supplyAmount;
});

const quantity = ref(100);
const qty = computed({
  get: () => {
    return parseFloat(quantity.value.toFixed(6));
  },
  set: (val) => {
    quantity.value = val;
  },
});
const amount = computed({
  get: () => {
    return quantity.value * (ticker.value?.converted_last?.usd || 0)
  },
  set: val => {
    quantity.value = val / (ticker.value?.converted_last?.usd || 1)
  }
})

</script>

<template>
  <div>
    <div v-if="coinInfo && coinInfo.name" class="modern-card shadow-modern">
      <div class="grid grid-cols-2 md:grid-cols-3 p-4">
        <div class="col-span-2 md:col-span-1">
          <div class="text-xl font-semibold text-gray-900 dark:text-white">
            {{ coinInfo.name }} (<span class="uppercase">{{
              coinInfo.symbol
            }}</span>)
          </div>

          <div v-if="ticker">
            <div class="dropdown dropdown-hover w-full">
              <label>
                <div
                  class="bg-gray-50 dark:bg-epix-gray flex items-center justify-between px-4 py-2 cursor-pointer rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-epix-gray-light transition-colors duration-200">
                  <div>
                    <div class="font-semibold text-xl text-gray-900 dark:text-white">
                      {{ ticker?.market?.name || '' }}
                    </div>
                    <div class="text-blue-600 dark:text-blue-400 text-sm">
                      {{ shortName(ticker?.base, ticker?.coin_id) }}/{{
                        shortName(ticker?.target, ticker?.target_coin_id)
                      }}
                    </div>
                  </div>

                  <div class="text-right">
                    <div class="text-xl font-semibold text-gray-900 dark:text-white">
                      ${{ formatPrice(ticker?.converted_last?.usd) }}
                    </div>
                    <div class="text-sm" :class="store.priceColor">{{ store.priceChange }}%</div>
                  </div>
                </div>
              </label>
              <div class="dropdown-content pt-1">
                <div class="h-64 overflow-auto w-full shadow-modern rounded-lg">
                  <ul class="menu w-full bg-white dark:bg-epix-gray rounded-lg border border-gray-200 dark:border-gray-700">
                    <li v-for="(item, index) in store.coinInfo.tickers" :key="index" @click="store.selectTicker(index)">
                      <div class="flex items-center justify-between hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200">
                        <div class="flex-1">
                          <div class="text-gray-900 dark:text-white text-sm" :class="trustColor(item.trust_score)">
                            {{ item?.market?.name }}
                          </div>
                          <div class="text-sm text-gray-500 dark:text-gray-400">
                            {{ shortName(item?.base, item?.coin_id) }}/{{
                              shortName(item?.target, item?.target_coin_id)
                            }}
                          </div>
                        </div>

                        <div class="text-base text-gray-900 dark:text-white">
                           ${{ formatPrice(item?.converted_last?.usd) }}
                        </div>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div class="flex">
              <label class="modern-button !px-1 my-5 mr-2" for="calculator">
                <svg class="w-8 h-8" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <rect x="4" y="2" width="16" height="20" rx="2"></rect> <line x1="8" x2="16" y1="6" y2="6"></line> <line x1="16" x2="16" y1="14" y2="18"></line> <path d="M16 10h.01"></path> <path d="M12 10h.01"></path> <path d="M8 10h.01"></path> <path d="M12 14h.01"></path> <path d="M8 14h.01"></path> <path d="M12 18h.01"></path> <path d="M8 18h.01"></path> </g></svg>
              </label>
              <!-- Put this part before </body> tag -->
              <input type="checkbox" id="calculator" class="modal-toggle" />
              <div class="modal">
                <div class="modal-box">
                  <label for="calculator" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">&#10005;</label>
                  <h3 class="text-lg font-bold">{{ $t('index.price_calculator') }}</h3>
                  <div class="flex flex-col w-full mt-5">
                    <div
                      class="grid h-20 flex-grow card rounded-box place-items-center"
                    >
                      <div class="join w-full">
                        <label class="join-item btn">
                          <span class="uppercase">{{ coinInfo.symbol }}</span>
                        </label>
                        <input
                          type="number"
                          v-model="qty"
                          min="0"
                          placeholder="Input a number"
                          class="input grow input-bordered join-item"
                        />
                      </div>
                    </div>
                    <div class="divider">=</div>
                    <div
                      class="grid h-20 flex-grow card rounded-box place-items-center"
                    >
                      <div class="join w-full">
                        <label class="join-item btn">
                          <span>USD</span>
                        </label>
                        <input
                          type="number"
                          v-model="amount"
                          min="0"
                          placeholder="Input amount"
                          class="join-item grow input input-bordered"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <label class="modal-backdrop" for="calculator">{{
                  $t('index.close')
                }}</label>
              </div>
              <a class="my-5 !text-white modern-button grow px-4 py-2 text-center" :href="tickerUrl(ticker.trade_url)"
                target="_blank">
                {{ $t('index.buy') }} {{ coinInfo.symbol || '' }}
              </a>
            </div>
            <div class="mt-3 bg-gray-50 dark:bg-epix-gray rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
              <div class="text-sm text-gray-600 dark:text-gray-400">Market Cap</div>
              <div class="text-lg font-semibold text-gray-900 dark:text-white">${{ formatSmallPrice(marketCap) }}</div>
            </div>
          </div>
        </div>

        <div class="col-span-2">
          <PriceMarketChart />
        </div>
      </div>
      <div class="h-[1px] w-full bg-gray-100 dark:bg-[#384059]"></div>
      <div class="max-h-[250px] overflow-auto p-4 text-sm">
        <MdEditor
          :model-value="coinInfo.description?.en"
          previewOnly
        ></MdEditor>
      </div>
      <div class="mx-4 flex flex-wrap items-center">
        <div
          v-for="tag in coinInfo.categories"
          class="mr-2 mb-4 text-xs bg-gray-100 dark:bg-[#384059] px-3 rounded-full py-1"
        >
          {{ tag }}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 md:!grid-cols-3 lg:!grid-cols-6 mt-4">
      <div v-for="(item, key) in store.stats" :key="key">
        <CardStatisticsVertical v-bind="item" />
      </div>
    </div>

    <div v-if="blockchain.supportModule('governance')" class="modern-card mt-4 shadow-modern">
      <div class="px-4 pt-4 pb-2 text-lg font-semibold text-gray-900 dark:text-white">
        {{ $t('index.active_proposals') }}
      </div>
      <div class="px-4 pb-4">
        <ProposalListItem :proposals="store?.proposals" />
      </div>
      <div class="pb-8 text-center text-gray-600 dark:text-gray-400" v-if="store.proposals?.proposals?.length === 0">
        {{ $t('index.no_active_proposals') }}
      </div>
    </div>

    <div class="modern-card mt-4 shadow-modern">
      <div class="flex justify-between px-4 pt-4 pb-2 text-lg font-semibold text-gray-900 dark:text-white">
        <span class="truncate" >{{ walletStore.currentAddress || 'Not Connected' }}</span>
        <RouterLink v-if="walletStore.currentAddress"
          class="float-right text-sm cursor-pointert text-epix-teal hover:text-epix-accent no-underline font-medium transition-colors duration-200"
          :to="`/${chain}/account/${walletStore.currentAddress}`">{{ $t('index.more') }}</RouterLink>
      </div>
      <div class="grid grid-cols-1 md:!grid-cols-4 auto-cols-auto gap-4 px-4 pb-6">
        <div class="bg-gray-50 dark:bg-epix-gray rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
          <div class="text-sm mb-1 text-gray-600 dark:text-gray-400">{{ $t('account.balance') }}</div>
          <div class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ format.formatToken(walletStore.balanceOfStakingToken) }}
          </div>
          <div class="text-sm text-green-600 dark:text-green-400">
            ${{ format.tokenValue(walletStore.balanceOfStakingToken) }}
          </div>
        </div>
        <div class="bg-gray-50 dark:bg-epix-gray rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
          <div class="text-sm mb-1 text-gray-600 dark:text-gray-400">{{ $t('module.staking') }}</div>
          <div class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ format.formatToken(walletStore.stakingAmount) }}
          </div>
          <div class="text-sm text-green-600 dark:text-green-400">
            ${{ format.tokenValue(walletStore.stakingAmount) }}
          </div>
        </div>
        <div class="bg-gray-50 dark:bg-epix-gray rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
          <div class="text-sm mb-1 text-gray-600 dark:text-gray-400">{{ $t('index.reward') }}</div>
          <div class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ format.formatToken(walletStore.rewardAmount) }}
          </div>
          <div class="text-sm text-green-600 dark:text-green-400">
            ${{ format.tokenValue(walletStore.rewardAmount) }}
          </div>
        </div>
        <div class="bg-gray-50 dark:bg-epix-gray rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
          <div class="text-sm mb-1 text-gray-600 dark:text-gray-400">{{ $t('index.unbonding') }}</div>
          <div class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ format.formatToken(walletStore.unbondingAmount) }}
          </div>
          <div class="text-sm text-green-600 dark:text-green-400">
            ${{ format.tokenValue(walletStore.unbondingAmount) }}
          </div>
        </div>
      </div>

      <div
        v-if="walletStore.delegations.length > 0"
        class="px-4 pb-4 space-y-3"
      >
        <div v-for="(item, index) in walletStore.delegations" :key="index"
          class="bg-gray-50 dark:bg-epix-gray rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between mb-2">
            <RouterLink class="text-epix-teal hover:text-epix-accent hover:underline transition-colors duration-200 no-underline font-medium text-sm" :to="`/${chain}/staking/${item?.delegation?.validator_address}`">
              {{ format.validatorFromBech32(item?.delegation?.validator_address) }}
            </RouterLink>
          </div>
          <div class="grid grid-cols-2 gap-2 text-sm mb-3">
            <div>
              <span class="text-gray-500 dark:text-gray-400 text-xs">{{ $t('account.delegations') }}</span>
              <div class="text-gray-900 dark:text-white font-mono">{{ format.formatToken(item?.balance) }}</div>
            </div>
            <div>
              <span class="text-gray-500 dark:text-gray-400 text-xs">{{ $t('account.rewards') }}</span>
              <div class="text-gray-900 dark:text-white font-mono">
                {{ format.formatTokens(walletStore?.rewards?.rewards?.find((el) => el?.validator_address === item?.delegation?.validator_address)?.reward) }}
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            <label for="delegate" class="modern-button !text-xs px-3 py-1.5 rounded-sm whitespace-nowrap"
              @click="dialog.open('delegate', { validator_address: item.delegation.validator_address }, updateState)">
              {{ $t('account.btn_delegate') }}
            </label>
            <label for="withdraw" class="modern-button !text-xs px-3 py-1.5 rounded-sm whitespace-nowrap"
              @click="dialog.open('withdraw', { validator_address: item.delegation.validator_address }, updateState)">
              {{ $t('index.btn_withdraw_reward') }}
            </label>
          </div>
        </div>
      </div>

      <div class="grid gap-2 md:gap-4 px-4 pb-6 mt-4" :class="walletStore.delegations.length > 1 ? 'grid-cols-4' : 'grid-cols-3'">
        <label for="PingTokenConvert" class="modern-button text-white px-2 py-1.5 md:px-4 md:py-2 text-center text-xs md:text-sm">{{ $t('index.btn_swap') }}</label>
        <label for="send" class="modern-button text-white px-2 py-1.5 md:px-4 md:py-2 text-center text-xs md:text-sm" @click="dialog.open('send', {}, updateState)">{{ $t('account.btn_send') }}</label>
        <label for="delegate" class="modern-button text-white px-2 py-1.5 md:px-4 md:py-2 text-center text-xs md:text-sm"
          @click="dialog.open('delegate', {}, updateState)">{{ $t('account.btn_delegate') }}</label>
        <label v-if="walletStore.delegations.length > 1" for="withdraw" class="modern-button text-white px-2 py-1.5 md:px-4 md:py-2 text-center text-xs md:text-sm"
          @click="dialog.open('withdraw', {}, updateState)">Claim All</label>
        <RouterLink to="/wallet/receive" class="btn !bg-info !border-info text-white hidden">{{ $t('index.receive') }}</RouterLink>
      </div>
      <Teleport to="body">
        <ping-token-convert
          :chain-name="blockchain?.current?.prettyName"
          :endpoint="blockchain?.endpoint?.address"
          :hd-path="walletStore?.connectedWallet?.hdPath"
        ></ping-token-convert>
      </Teleport>
    </div>


    <div v-if="!store.coingeckoId" class="modern-card mt-4 shadow-modern">
      <div class="px-4 pt-4 pb-2 text-lg font-semibold text-gray-900 dark:text-white">
        {{ $t('index.node_info') }}
      </div>
      <ArrayObjectElement :value="paramStore.nodeVersion?.items" :thead="false" />
      <div class="h-4"></div>
    </div>
  </div>
</template>

<route>
  {
    meta: {
      i18n: 'dashboard',
      order: 1,
    }
  }
</route>
