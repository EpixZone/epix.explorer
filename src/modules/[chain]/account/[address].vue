<script lang="ts" setup>
import {
  useBlockchain,
  useFormatter,
  useStakingStore,
  useTxDialog,
  useBaseStore,
} from '@/stores';
import DynamicComponent from '@/components/dynamic/DynamicComponent.vue';
import DonutChart from '@/components/charts/DonutChart.vue';
import ApexCharts from 'vue3-apexcharts';
import { computed, ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { getDonutChartConfig } from '@/components/charts/apexChartConfig';

import type {
  AuthAccount,
  Delegation,
  TxResponse,
  DelegatorRewards,
  UnbondingResponses,
} from '@/types';
import type { Coin } from '@cosmjs/amino';
import Countdown from '@/components/Countdown.vue';
import { fromBase64 } from '@cosmjs/encoding';

const props = defineProps(['address', 'chain']);

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const dialog = useTxDialog();
const format = useFormatter();
const baseStore = useBaseStore();
const account = ref({} as AuthAccount);
const txs = ref({} as TxResponse[]);
const delegations = ref([] as Delegation[]);
const rewards = ref({} as DelegatorRewards);
const balances = ref([] as Coin[]);
const recentReceived = ref([] as TxResponse[]);
const unbonding = ref([] as UnbondingResponses[]);
const unbondingTotal = ref(0);
const chart = {};
onMounted(() => {
  // Wait for blockchain to be properly initialized
  if (blockchain.chainName === props.chain && blockchain.rpc) {
    loadAccount(props.address);
  }
});

// Watch for blockchain changes
blockchain.$subscribe((mutation, state) => {
  if (state.chainName === props.chain && state.rpc) {
    loadAccount(props.address);
  }
});
const totalAmountByCategory = computed(() => {
  let sumDel = 0;
  delegations.value?.forEach((x) => {
    sumDel += Number(x.balance.amount);
  });
  let sumRew = 0;
  rewards.value?.total?.forEach((x) => {
    sumRew += Number(x.amount);
  });
  let sumBal = 0;
  balances.value?.forEach((x) => {
    sumBal += Number(x.amount);
  });
  let sumUn = 0;
  unbonding.value?.forEach((x) => {
    x.entries?.forEach((y) => {
      sumUn += Number(y.balance);
    });
  });
  return [sumBal, sumDel, sumRew, sumUn];
});

// Formatted amounts for chart display (converted from aepix to EPIX)
const formattedAmountByCategory = computed(() => {
  return totalAmountByCategory.value.map(amount => {
    // Convert from aepix (18 decimals) to EPIX
    return Number((amount / 1e18).toFixed(2));
  });
});

// Custom chart configuration with formatted tooltips
const customChartConfig = computed(() => {
  const baseConfig = getDonutChartConfig(baseStore.theme, labels);
  return {
    ...baseConfig,
    tooltip: {
      theme: 'dark',
      y: {
        formatter: function (val: number, opts: any) {
          // Format the value with commas for thousands
          const formattedValue = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
          }).format(val);
          return `${formattedValue} EPIX`;
        }
      }
    },
    plotOptions: {
      ...baseConfig.plotOptions,
      pie: {
        ...baseConfig.plotOptions.pie,
        donut: {
          ...baseConfig.plotOptions.pie.donut,
          labels: {
            ...baseConfig.plotOptions.pie.donut.labels,
            value: {
              ...baseConfig.plotOptions.pie.donut.labels.value,
              formatter: function (val: string) {
                // Format the center value with commas for thousands
                const numVal = parseFloat(val);
                const formattedValue = new Intl.NumberFormat('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2
                }).format(numVal);
                return formattedValue;
              }
            }
          }
        }
      }
    }
  };
});

const labels = ['Balance', 'Delegation', 'Reward', 'Unbonding'];

const totalAmount = computed(() => {
  return totalAmountByCategory.value.reduce((p, c) => c + p, 0);
});

const totalValue = computed(() => {
  let value = 0;
  delegations.value?.forEach((x) => {
    value += format.tokenValueNumber(x.balance);
  });
  rewards.value?.total?.forEach((x) => {
    value += format.tokenValueNumber(x);
  });
  balances.value?.forEach((x) => {
    value += format.tokenValueNumber(x);
  });
  unbonding.value?.forEach((x) => {
    x.entries?.forEach((y) => {
      value += format.tokenValueNumber({amount: y.balance, denom: stakingStore.params.bond_denom});
    });
  });
  return format.formatNumber(value, '0,0.00');
});


function loadAccount(address: string) {
  // Check if RPC client is ready
  if (!blockchain.rpc) {
    return;
  }

  // Reset data
  balances.value = [];
  delegations.value = [];
  rewards.value = { total: [], rewards: [] };
  unbonding.value = [];
  unbondingTotal.value = 0;

  blockchain.rpc.getAuthAccount(address).then((x) => {
    account.value = x.account;
  }).catch((error) => {
    // Set a minimal account object so we can still display the page
    account.value = { address: address } as AuthAccount;
  });

  blockchain.rpc.getTxsBySender(address).then((x) => {
    txs.value = x.tx_responses;
  });

  blockchain.rpc.getDistributionDelegatorRewards(address).then((x) => {
    rewards.value = x;
  });

  blockchain.rpc.getStakingDelegations(address).then((x) => {
    delegations.value = x.delegation_responses;
  });

  blockchain.rpc.getBankBalances(address).then((x) => {
    balances.value = x.balances || [];
  });

  blockchain.rpc.getStakingDelegatorUnbonding(address).then((x) => {
    unbonding.value = x.unbonding_responses;
    x.unbonding_responses?.forEach((y) => {
      y.entries.forEach((z) => {
        unbondingTotal.value += Number(z.balance);
      });
    });
  });

  const receivedQuery =  `?&pagination.reverse=true&events=coin_received.receiver='${address}'&pagination.limit=5`;
  blockchain.rpc.getTxs(receivedQuery, {}).then((x) => {
    recentReceived.value = x.tx_responses;
  });
}

function updateEvent() {
  loadAccount(props.address);
}

function mapAmount(events:{type: string, attributes: {key: string, value: string}[]}[]) {
  if(!events) return []
  return events.find(x => x.type==='coin_received')?.attributes
    .filter(x => x.key === 'YW1vdW50'|| x.key === `amount`)
    .map(x => x.key==='amount'? x.value : String.fromCharCode(...fromBase64(x.value)))
}
</script>
<template>
  <div v-if="props.address">
    <!-- address -->
    <div class="bg-black border border-gray-800 px-6 py-4 rounded-lg mb-6">
      <div class="flex items-center">
        <!-- img -->
        <div class="inline-flex relative w-12 h-12 rounded-lg bg-epix-primary/10 border border-epix-primary/20">
          <div class="w-full inline-flex items-center align-middle flex-none justify-center">
            <Icon
              icon="mdi-qrcode"
              class="text-epix-primary"
              style="width: 28px; height: 28px"
            />
          </div>
        </div>
        <!-- content -->
        <div class="flex flex-1 flex-col truncate pl-4">
          <h2 class="text-sm font-semibold text-white mb-1">{{ $t('account.address') }}:</h2>
          <span class="text-xs text-gray-400 truncate font-mono"> {{ props.address }}</span>
        </div>
      </div>
    </div>

    <!-- Assets -->
    <div class="bg-black border border-gray-800 px-6 py-4 rounded-lg mb-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-lg font-semibold text-white">{{ $t('account.assets') }}</h2>
        <!-- button -->
        <div class="flex gap-3">
            <label
              for="send"
              class="modern-button px-4 py-2"
              @click="dialog.open('send', {}, updateEvent)"
              >{{ $t('account.btn_send') }}</label
            >
            <label
              for="transfer"
              class="modern-button px-4 py-2"
              @click="
                dialog.open(
                  'transfer',
                  {
                    chain_name: blockchain.current?.prettyName,
                  },
                  updateEvent
                )
              "
              >{{ $t('account.btn_transfer') }}</label
            >
          </div>
      </div>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="md:col-span-1">
          <ApexCharts
            type="donut"
            height="410"
            :options="customChartConfig"
            :series="formattedAmountByCategory"
          />
        </div>
        <div class="md:col-span-2">
          <!-- list-->
          <div class="space-y-3">
            <!--balances  -->
            <div
              class="flex items-center p-4 bg-gray-900/50 border border-gray-800 rounded-lg"
              v-for="(balanceItem, index) in balances"
              :key="index"
            >
              <div class="w-10 h-10 rounded-lg bg-epix-teal/10 border border-epix-teal/20 flex items-center justify-center mr-4" title="Available Balance">
                <Icon icon="mdi-account-cash" class="text-epix-teal" size="20" />
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold text-white">
                  {{ format.formatToken(balanceItem) }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ format.calculatePercent(balanceItem.amount, totalAmount) }}
                </div>
              </div>
              <div class="text-xs px-3 py-1 bg-epix-primary/10 border border-epix-primary/20 rounded-lg text-epix-primary font-mono">
                ${{ format.tokenValue(balanceItem) }}
              </div>
            </div>
            <!--delegations  -->
            <div
              class="flex items-center p-4 bg-gray-900/50 border border-gray-800 rounded-lg"
              v-for="(delegationItem, index) in delegations"
              :key="index"
            >
              <div class="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mr-4" title="Staked (Delegated)">
                <Icon icon="mdi-user-clock" class="text-orange-500" size="20" />
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold text-white">
                  {{ format.formatToken(delegationItem?.balance) }}
                </div>
                <div class="text-xs text-gray-400">
                  {{
                    format.calculatePercent(
                      delegationItem?.balance?.amount,
                      totalAmount
                    )
                  }}
                </div>
              </div>
              <div class="text-xs px-3 py-1 bg-epix-primary/10 border border-epix-primary/20 rounded-lg text-epix-primary font-mono">
                ${{ format.tokenValue(delegationItem?.balance) }}
              </div>
            </div>
            <!-- rewards.total -->
            <div
              class="flex items-center p-4 bg-gray-900/50 border border-gray-800 rounded-lg"
              v-for="(rewardItem, index) in rewards.total"
              :key="index"
            >
              <div class="w-10 h-10 rounded-lg bg-epix-teal/10 border border-epix-teal/20 flex items-center justify-center mr-4" title="Staking Rewards">
                <Icon
                  icon="mdi-account-arrow-up"
                  class="text-epix-teal"
                  size="20"
                />
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold text-white">
                  {{ format.formatToken(rewardItem) }}
                </div>
                <div class="text-xs text-gray-400">{{ format.calculatePercent(rewardItem.amount, totalAmount) }}</div>
              </div>
              <div class="text-xs px-3 py-1 bg-epix-primary/10 border border-epix-primary/20 rounded-lg text-epix-primary font-mono">
                ${{ format.tokenValue(rewardItem) }}
              </div>
            </div>
            <!-- unbonding -->
            <div class="flex items-center p-4 bg-gray-900/50 border border-gray-800 rounded-lg">
              <div class="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mr-4" title="Unbonding (Unstaking)">
                <Icon
                  icon="mdi-account-arrow-right"
                  class="text-blue-500"
                  size="20"
                />
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold text-white">
                  {{
                    format.formatToken({
                      amount: String(unbondingTotal),
                      denom: stakingStore.params.bond_denom,
                    })
                  }}
                </div>
                <div class="text-xs text-gray-400">
                  {{ format.calculatePercent(unbondingTotal, totalAmount) }}
                </div>
              </div>
              <div class="text-xs px-3 py-1 bg-epix-primary/10 border border-epix-primary/20 rounded-lg text-epix-primary font-mono">
                ${{format.tokenValue({
                      amount: String(unbondingTotal),
                      denom: stakingStore.params.bond_denom,
                    })
                  }}
              </div>
            </div>
          </div>
          <div class="mt-6 pt-4 border-t border-gray-800">
            <div class="text-right">
              <span class="text-gray-400 text-sm">{{ $t('account.total_value') }}:</span>
              <span class="text-xl font-bold text-white ml-2">${{ totalValue }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Delegations -->
    <div class="bg-black border border-gray-800 px-6 py-4 rounded-lg mb-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-lg font-semibold text-white">{{ $t('account.delegations') }}</h2>
        <div class="flex gap-3">
          <label
            for="delegate"
            class="modern-button px-4 py-2"
            @click="dialog.open('delegate', {}, updateEvent)"
            >{{ $t('account.btn_delegate') }}</label
          >
          <label
            for="withdraw"
            class="modern-button px-4 py-2"
            @click="dialog.open('withdraw', {}, updateEvent)"
            >{{ $t('account.btn_withdraw') }}</label
          >
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800">
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.validator') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.delegation') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.rewards') }}</th>
              <th class="py-3 text-right text-gray-400 font-medium">{{ $t('account.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="delegations.length === 0">
              <td colspan="4" class="py-8">
                <div class="text-center text-gray-500">{{ $t('account.no_delegations') }}</div>
              </td>
            </tr>
            <tr v-for="(v, index) in delegations" :key="index" class="border-b border-gray-800/50 hover:bg-gray-900/30">
              <td class="py-4">
                <RouterLink
                  :to="`/${chain}/staking/${v.delegation.validator_address}`"
                  class="text-epix-teal hover:text-epix-accent transition-colors"
                  >{{
                    format.validatorFromBech32(v.delegation.validator_address) || v.delegation.validator_address
                  }}</RouterLink
                >
              </td>
              <td class="py-4 text-white font-mono">
                {{ format.formatToken(v.balance, true, '0,0.[000000]') }}
              </td>
              <td class="py-4 text-white font-mono">
                {{
                  format.formatTokens(
                    rewards?.rewards?.find(
                      (x) =>
                        x.validator_address === v.delegation.validator_address
                    )?.reward
                  )
                }}
              </td>
              <td class="py-4">
                <div v-if="v.balance" class="flex justify-end gap-2">
                  <label
                    for="delegate"
                    class="modern-button text-xs px-3 py-1"
                    @click="
                      dialog.open(
                        'delegate',
                        {
                          validator_address: v.delegation.validator_address,
                        },
                        updateEvent
                      )
                    "
                    >{{ $t('account.btn_delegate') }}</label
                  >
                  <label
                    for="redelegate"
                    class="modern-button text-xs px-3 py-1"
                    @click="
                      dialog.open(
                        'redelegate',
                        {
                          validator_address: v.delegation.validator_address,
                        },
                        updateEvent
                      )
                    "
                    >{{ $t('account.btn_redelegate') }}</label
                  >
                  <label
                    for="unbond"
                    class="modern-button text-xs px-3 py-1"
                    @click="
                      dialog.open(
                        'unbond',
                        {
                          validator_address: v.delegation.validator_address,
                        },
                        updateEvent
                      )
                    "
                    >{{ $t('account.btn_unbond') }}</label
                  >
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Unbonding Delegations -->
    <div
      class="bg-black border border-gray-800 px-6 py-4 rounded-lg mb-6"
      v-if="unbonding && unbonding.length > 0"
    >
      <h2 class="text-lg font-semibold text-white mb-6">{{ $t('account.unbonding_delegations') }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800">
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.creation_height') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.initial_balance') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.balance') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.completion_time') }}</th>
            </tr>
          </thead>
          <tbody v-for="(v, index) in unbonding" :key="index">
              <tr>
                <td class="py-3 bg-gray-900/50 border border-gray-800 rounded-lg" colspan="4">
                  <RouterLink
                    :to="`/${chain}/staking/${v.validator_address}`"
                    class="text-epix-teal hover:text-epix-accent transition-colors font-mono text-sm"
                    >{{
                      v.validator_address
                    }}</RouterLink
                  >
                </td>
              </tr>
              <tr v-for="entry in v.entries" class="border-b border-gray-800/50 hover:bg-gray-900/30">
                <td class="py-3 text-white">{{ entry.creation_height }}</td>
                <td class="py-3 text-white font-mono">
                  {{
                    format.formatToken(
                      {
                        amount: entry.initial_balance,
                        denom: stakingStore.params.bond_denom,
                      },
                      true,
                      '0,0.[00]'
                    )
                  }}
                </td>
                <td class="py-3 text-white font-mono">
                  {{
                    format.formatToken(
                      {
                        amount: entry.balance,
                        denom: stakingStore.params.bond_denom,
                      },
                      true,
                      '0,0.[00]'
                    )
                  }}
                </td>
                <td class="py-3 text-white">
                  <Countdown :time="new Date(entry.completion_time).getTime() - new Date().getTime()" />
                </td>
              </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Transactions -->
    <div class="bg-black border border-gray-800 px-6 py-4 rounded-lg mb-6">
      <h2 class="text-lg font-semibold text-white mb-6">{{ $t('account.transactions') }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800">
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.height') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.hash') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.messages') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.time') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="txs.length === 0">
              <td colspan="4" class="py-8">
                <div class="text-center text-gray-500">{{ $t('account.no_transactions') }}</div>
              </td>
            </tr>
            <tr v-for="(v, index) in txs" :key="index" class="border-b border-gray-800/50 hover:bg-gray-900/30">
              <td class="py-3">
                <RouterLink :to="`/${chain}/block/${v.height}`" class="text-epix-teal hover:text-epix-accent transition-colors">{{
                  v.height
                }}</RouterLink>
              </td>
              <td class="py-3 max-w-[200px]">
                <RouterLink :to="`/${chain}/tx/${v.txhash}`" class="text-epix-teal hover:text-epix-accent transition-colors font-mono text-xs truncate block">
                  {{ v.txhash }}
                </RouterLink>
              </td>
              <td class="py-3">
                <div class="flex items-center">
                  <span class="text-white mr-2">
                    {{ format.messages(v.tx.body.messages) }}
                  </span>
                  <Icon
                    v-if="v.code === 0"
                    icon="mdi-check"
                    class="text-green-500 text-lg"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-red-500 text-lg" />
                </div>
              </td>
              <td class="py-3 text-white">
                {{ format.toLocaleDate(v.timestamp) }}
                <span class="text-xs text-gray-400">({{ format.toDay(v.timestamp, 'from') }})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Received -->
    <div class="bg-black border border-gray-800 px-6 py-4 rounded-lg mb-6">
      <h2 class="text-lg font-semibold text-white mb-6">{{ $t('account.received') }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800">
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.height') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.hash') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.amount') }}</th>
              <th class="py-3 text-left text-gray-400 font-medium">{{ $t('account.time') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="recentReceived.length === 0">
              <td colspan="4" class="py-8">
                <div class="text-center text-gray-500">{{ $t('account.no_transactions') }}</div>
              </td>
            </tr>
            <tr v-for="(v, index) in recentReceived" :key="index" class="border-b border-gray-800/50 hover:bg-gray-900/30">
              <td class="py-3">
                <RouterLink :to="`/${chain}/block/${v.height}`" class="text-epix-teal hover:text-epix-accent transition-colors">{{
                  v.height
                }}</RouterLink>
              </td>
              <td class="py-3 max-w-[200px]">
                <RouterLink :to="`/${chain}/tx/${v.txhash}`" class="text-epix-teal hover:text-epix-accent transition-colors font-mono text-xs truncate block">
                  {{ v.txhash }}
                </RouterLink>
              </td>
              <td class="py-3">
                <div class="flex items-center">
                  <span class="text-white mr-2 font-mono">
                    {{ mapAmount(v.events)?.join(", ")}}
                  </span>
                  <Icon
                    v-if="v.code === 0"
                    icon="mdi-check"
                    class="text-green-500 text-lg"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-red-500 text-lg" />
                </div>
              </td>
              <td class="py-3 text-white">
                {{ format.toLocaleDate(v.timestamp) }}
                <span class="text-xs text-gray-400">({{ format.toDay(v.timestamp, 'from') }})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Account -->
    <div class="bg-black border border-gray-800 px-6 py-4 rounded-lg mb-6">
      <h2 class="text-lg font-semibold text-white mb-6">{{ $t('account.acc') }}</h2>
      <DynamicComponent :value="account" />
    </div>
  </div>
  <div v-else class="text-center text-red-400 text-sm py-8">{{ $t('account.error') }}</div>
</template>
