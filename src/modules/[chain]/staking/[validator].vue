<script setup lang="ts">
import { parseCoins } from '@cosmjs/stargate';
import {
  useBankStore,
  useBlockchain,
  useDistributionStore,
  useFormatter,
  useMintStore,
  useStakingStore,
  useTxDialog,
} from '@/stores';
import { onMounted, computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import CommissionRate from '@/components/ValidatorCommissionRate.vue';
import {
  consensusPubkeyToHexAddress,
  operatorAddressToAccount,
  pubKeyToValcons,
} from '@/libs';
import { PageRequest, type Coin, type Delegation, type PaginatedDelegations, type PaginatedTxs, type Validator } from '@/types';
import PaginationBar from '@/components/PaginationBar.vue';
import { fromBase64, toBase64 } from '@cosmjs/encoding';
import { stringToUint8Array, uint8ArrayToString } from '@/libs/utils';

const props = defineProps(['validator', 'chain']);

const staking = useStakingStore();
const blockchain = useBlockchain();
const format = useFormatter();
const dialog = useTxDialog();
const page = new PageRequest();

const validator: string = props.validator;

const v = ref({} as Validator);
const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});
const identity = ref('');
const rewards = ref([] as Coin[] | undefined);
const commission = ref([] as Coin[] | undefined);
const delegations = ref({} as PaginatedDelegations)
const addresses = ref(
  {} as {
    account: string;
    operAddress: string;
    hex: string;
    valCons: string;
  }
);
const selfBonded = ref({} as Delegation);

addresses.value.account = operatorAddressToAccount(validator);
// load self bond
staking
  .fetchValidatorDelegation(validator, addresses.value.account)
  .then((x) => {
    if (x) {
      selfBonded.value = x.delegation_response;
    }
  });

const txs = ref({} as PaginatedTxs);

blockchain.rpc.getTxsBySender(addresses.value.account).then((x) => {
  txs.value = x;
});

const apr = computed(() => {
  const rate = Number(v.value.commission?.commission_rates.rate || 0);
  const inflation = useMintStore().inflation;
  const communityTax = Number(useDistributionStore().params.community_tax);
  const bondedRatio = Number(staking.pool.bonded_tokens) / Number(useBankStore().supply.amount);

  return format.percent((1 - communityTax) * (1 - rate) * Number(inflation) / bondedRatio);
});

const selfRate = computed(() => {
  if (selfBonded.value.balance?.amount) {
    return format.calculatePercent(
      selfBonded.value.balance.amount,
      v.value.tokens
    );
  }
  return '-';
});

const logo = (identity?: string) => {
  if (!identity) return '';
  const url = avatars.value[identity] || '';
  return url.startsWith('http')
    ? url
    : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

const fetchAvatar = (identity: string) => {
  // fetch avatar from keybase
  return new Promise<void>((resolve) => {
    staking
      .keybase(identity)
      .then((d) => {
        if (Array.isArray(d.them) && d.them.length > 0) {
          const uri = String(d.them[0]?.pictures?.primary?.url).replace(
            'https://s3.amazonaws.com/keybase_processed_uploads/',
            ''
          );

          avatars.value[identity] = uri;
          resolve();
        } else throw new Error(`failed to fetch avatar for ${identity}.`);
      })
      .catch((error) => {
        // console.error(error); // uncomment this if you want the user to see if the avatar failed to load.
        resolve();
      });
  });
};

const loadAvatar = (identity: string) => {
  // fetches avatar from keybase and stores it in localStorage
  fetchAvatar(identity).then(() => {
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  });
};

onMounted(() => {
  if (validator) {
    staking.fetchValidator(validator).then((res) => {
      v.value = res.validator;
      identity.value = res.validator?.description?.identity || '';
      if (identity.value && !avatars.value[identity.value]) loadAvatar(identity.value);

      addresses.value.hex = consensusPubkeyToHexAddress(
        v.value.consensus_pubkey
      );
      addresses.value.valCons = pubKeyToValcons(
        v.value.consensus_pubkey,
        blockchain.current?.bech32ConsensusPrefix || "",
      );
    });
    blockchain.rpc
      .getDistributionValidatorOutstandingRewards(validator)
      .then((res) => {
        rewards.value = res.rewards?.rewards?.sort(
          (a, b) => Number(b.amount) - Number(a.amount)
        );
        res.rewards?.rewards?.forEach((x) => {
          if (x.denom.startsWith('ibc/')) {
            format.fetchDenomTrace(x.denom);
          }
        });
      });
    blockchain.rpc.getDistributionValidatorCommission(validator).then((res) => {
      commission.value = res.commission?.commission?.sort(
        (a, b) => Number(b.amount) - Number(a.amount)
      );
      res.commission?.commission?.forEach((x) => {
        if (x.denom.startsWith('ibc/')) {
          format.fetchDenomTrace(x.denom);
        }
      });
    });

    // Disable delegations due to its bad performance
    // Comment out the following code if you want to enable it
    // pageload(1)

  }
});
let showCopyToast = ref(0);
const formatWebsiteUrl = (url?: string) => {
  if (!url) return '#';
  // If URL already has a protocol, return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Add https:// prefix for URLs without protocol
  return `https://${url}`;
};

const copyWebsite = async (url: string) => {
  if (!url) {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showCopyToast.value = 1;
    setTimeout(() => {
      showCopyToast.value = 0;
    }, 1000);
  } catch (err) {
    showCopyToast.value = 2;
    setTimeout(() => {
      showCopyToast.value = 0;
    }, 1000);
  }
};
const tipMsg = computed(() => {
  return showCopyToast.value === 2
    ? { class: 'error', msg: 'Copy Error!' }
    : { class: 'success', msg: 'Copy Success!' };
});

function pageload(p: number) {
  page.setPage(p);
  page.limit = 10;

  blockchain.rpc.getStakingValidatorsDelegations(validator, page).then(res => {
      delegations.value = res
  }) 
}

const events = ref({} as PaginatedTxs)

enum EventType {
  Delegate = 'delegate',
  Unbond = 'unbond',
}

const selectedEventType = ref(EventType.Delegate)

function loadPowerEvents(p: number, type: EventType) {
  selectedEventType.value = type
  page.setPage(p);
  page.setPageSize(5);
  blockchain.rpc.getTxs("?order_by=2&events={type}.validator='{validator}'", { type: selectedEventType.value, validator }, page).then(res => {
    events.value = res
  })
}

function pagePowerEvents(page: number) {
    loadPowerEvents(page, selectedEventType.value)
}

pagePowerEvents(1)

function mapEvents(events: {type: string, attributes: {key: string, value: string}[]}[]) {
  const attributes = events
    .filter(x => x.type === selectedEventType.value)
    .filter(x => x.attributes.findIndex(attr => attr.value === validator || attr.value === toBase64(stringToUint8Array(validator))) > -1)
    .map(x => {
      // check if attributes need to decode
      const output = {} as {[key: string]: string }

      if (x.attributes.findIndex(a => a.key === `amount`) > -1) {
        x.attributes.forEach(attr => {
          output[attr.key] = attr.value
        })
      } else {
        x.attributes.forEach(attr => {
          output[uint8ArrayToString(fromBase64(attr.key))] = uint8ArrayToString(fromBase64(attr.value))
        })
      };

      return output;
    });

  const coinsAsString = attributes.map((x: any) => x.amount).join(',');
  const coins = parseCoins(coinsAsString);

  return coins.map(coin => format.formatToken(coin)).join(', ');
}

function mapDelegators(messages: any[]) {
  if(!messages) return []
  return Array.from(new Set(messages.map(x => x.delegator_address || x.grantee)))
}

</script>
<template>
  <div>
    <div class="modern-card shadow-modern px-6 pt-4 pb-5">
      <div class="flex flex-col lg:!flex-row pt-2 pb-1">
        <div class="flex-1">
          <div class="flex">
            <div class="avatar mr-4 relative w-24 rounded-lg overflow-hidden">
              <div class="w-24 rounded-lg absolute opacity-10"></div>
              <div class="w-24 rounded-lg">
                <img
                  v-if="identity && avatars[identity] !== 'undefined'"
                  v-lazy="logo(identity)"
                  class="object-contain"
                  @error="
                    (e) => {
                      loadAvatar(identity);
                    }
                  "
                />
                <Icon
                  v-else
                  class="text-8xl text-gray-400"
                  :icon="`mdi-help-circle-outline`"
                />
              </div>
            </div>
            <div class="mx-2">
              <h4 class="text-xl font-semibold text-gray-900 dark:text-white">{{ v.description?.moniker }}</h4>
              <div class="text-sm mb-4 text-gray-600 dark:text-gray-400">
                {{ v.description?.identity || '-' }}
              </div>
              <label
                for="delegate"
                class="modern-button px-4 py-2 w-full text-center"
                @click="
                  dialog.open('delegate', {
                    validator_address: v.operator_address,
                  })
                "
                >{{ $t('account.btn_delegate') }}</label
              >
            </div>
          </div>
          <div class="m-4 text-sm">
            <p class="text-sm mb-3 font-medium text-gray-900 dark:text-white">{{ $t('staking.about_us') }}</p>
            <div class="card-list">
              <div class="flex items-center mb-2">
                <Icon icon="mdi-web" class="text-xl mr-1 text-purple-500" />
                <span class="font-bold mr-2 text-gray-700 dark:text-gray-300">{{ $t('staking.website') }}: </span>
                <a
                  :href="formatWebsiteUrl(v?.description?.website)"
                  :class="
                    v?.description?.website
                      ? 'cursor-pointer text-epix-teal hover:text-epix-accent transition-colors duration-200'
                      : 'cursor-default text-gray-500'
                  "
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ v.description?.website || '-' }}
                </a>
              </div>
              <div class="flex items-center">
                <Icon icon="mdi-email-outline" class="text-xl mr-1 text-purple-500" />
                <span class="font-bold mr-2 text-gray-700 dark:text-gray-300">{{ $t('staking.contact') }}: </span>
                <a
                  v-if="v.description?.security_contact"
                  :href="'mailto:' + v.description.security_contact || '#' "
                  class="cursor-pointer text-epix-teal hover:text-epix-accent transition-colors duration-200"
                >
                  {{ v.description?.security_contact || '-' }}
                </a>
              </div>
            </div>
            <p class="text-sm mt-4 mb-3 font-medium text-gray-900 dark:text-white">{{ $t('staking.validator_status') }}</p>
            <div class="card-list">
              <div class="flex items-center mb-2">
                <Icon icon="mdi-shield-account-outline" class="text-xl mr-1 text-purple-500" />
                <span class="font-bold mr-2 text-gray-700 dark:text-gray-300">{{ $t('staking.status') }}: </span
                ><span class="text-gray-900 dark:text-white">
                  {{ String(v.status).replace('BOND_STATUS_', '') }}
                </span>
              </div>
              <div class="flex items-center">
                <Icon icon="mdi-shield-alert-outline" class="text-xl mr-1 text-purple-500" />
                <span class="font-bold mr-2 text-gray-700 dark:text-gray-300">{{ $t('staking.jailed') }}: </span>
                <span class="text-gray-900 dark:text-white"> {{ v.jailed || '-' }} </span>
              </div>
            </div>
            <p class="text-sm mt-4 mb-3 font-medium text-gray-900 dark:text-white">{{ $t('staking.liquid_staking') }}</p>
            <div class="card-list">
              <div class="flex items-center mb-2">
                <Icon icon="mdi-lock" class="text-xl mr-1 text-purple-500" />
                <span class="font-bold mr-2 text-gray-700 dark:text-gray-300">{{ $t('staking.validator_bond_share') }}: </span>
                <span class="text-gray-900 dark:text-white"> {{ format.formatToken( {amount: v.validator_bond_shares, denom: staking.params.bond_denom }, false) }} </span>
              </div>
              <div class="flex items-center">
                <Icon icon="mdi-waves-arrow-right" class="text-xl mr-1 text-purple-500" />
                <span class="font-bold mr-2 text-gray-700 dark:text-gray-300">{{ $t('staking.liquid_staking_shares') }}: </span>
                <span class="text-gray-900 dark:text-white">
                  {{ format.formatToken( {amount: v.liquid_shares, denom: staking.params.bond_denom }, false) }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="flex-1">
          <div class="flex flex-col mt-10">
            <div class="flex mb-4">
              <div
                class="flex items-center justify-center rounded-lg w-12 h-12 bg-green-500/20"
              >
                <Icon icon="mdi-coin" class="text-2xl text-green-400" />
              </div>
              <div class="ml-4 flex flex-col justify-center">
                <h4 class="text-lg font-semibold text-gray-900 dark:text-white">
                  {{
                    format.formatToken2({
                      amount: v.tokens,
                      denom: staking.params.bond_denom,
                    })
                  }}
                </h4>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.total_bonded') }}</span>
              </div>
            </div>
            <div class="flex mb-4">
              <div
                class="flex items-center justify-center rounded-lg w-12 h-12 bg-blue-500/20"
              >
                <Icon icon="mdi-percent" class="text-2xl text-blue-400" />
              </div>
              <div class="ml-4 flex flex-col justify-center">
                <h4 class="text-lg font-semibold text-gray-900 dark:text-white">
                  {{ format.formatToken(selfBonded.balance) }} ({{ selfRate }})
                </h4>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.self_bonded') }}</span>
              </div>
            </div>

            <div class="flex mb-4">
              <div
                class="flex items-center justify-center rounded-lg w-12 h-12 bg-purple-500/20"
              >
                <Icon icon="mdi-account-tie" class="text-2xl text-purple-400" />
              </div>

              <div class="ml-4 flex flex-col">
                <h4 class="text-lg font-semibold text-gray-900 dark:text-white">
                  {{ v.min_self_delegation }} {{ staking.params.bond_denom }}
                </h4>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.min_self') }}</span>
              </div>
            </div>
            <div class="flex mb-4">
              <div
                class="flex items-center justify-center rounded-lg w-12 h-12 bg-orange-500/20"
              >
                <Icon icon="mdi-finance" class="text-2xl text-orange-400" />
              </div>
              <div class="ml-4 flex flex-col justify-center">
                <h4 class="text-lg font-semibold text-gray-900 dark:text-white">{{ apr }}</h4>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.annual_profit') }}</span>
              </div>
            </div>

            <div class="flex mb-4">
              <div
                class="flex items-center justify-center rounded-lg w-12 h-12 bg-red-500/20"
              >
                <Icon icon="mdi:arrow-down-bold-circle-outline" class="text-2xl text-red-400" />
              </div>
              <div class="ml-4 flex flex-col justify-center">
                <h4 class="text-lg font-semibold text-gray-900 dark:text-white">{{ v.unbonding_height }}</h4>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.unbonding_height') }}</span>
              </div>
            </div>

            <div class="flex mb-4">
              <div
                class="flex items-center justify-center rounded-lg w-12 h-12 bg-gray-500/20"
              >
                <Icon icon="mdi-clock" class="text-2xl text-gray-400" />
              </div>
              <div class="ml-4 flex flex-col justify-center">
                <h4 v-if="v.unbonding_time && !v.unbonding_time.startsWith('1970')" class="text-lg font-semibold text-gray-900 dark:text-white">{{ format.toDay(v.unbonding_time, 'from') }}</h4>
                <h4 v-else class="text-lg font-semibold text-gray-900 dark:text-white">-</h4>
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.unbonding_time') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="text-sm px-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">{{ v.description?.details }}</div>
    </div>

    <div class="mt-6 grid grid-cols-1 md:!grid-cols-3 gap-4">
      <div>
        <CommissionRate :commission="v.commission"></CommissionRate>
      </div>
      <div class="modern-card shadow-modern relative overflow-auto">
        <div class="text-lg font-semibold text-gray-900 dark:text-white px-6 pt-4">
          {{ $t('staking.commissions_&_rewards') }}
        </div>
        <div
          class="px-6 mt-1 flex flex-col justify-between pb-4 max-h-72"
          style="height: calc(100% - 50px)"
        >
          <div class="overflow-auto flex-1">
            <div class="text-sm mb-2 text-gray-700 dark:text-gray-300">{{ $t('staking.commissions') }}</div>
            <div
              v-for="(i, k) in commission"
              :key="`reward-${k}`"
              class="mr-1 mb-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded text-xs"
            >
              {{ format.formatToken2(i) }}
            </div>
            <div class="text-sm mb-2 mt-2 text-gray-700 dark:text-gray-300">{{ $t('staking.outstanding') }} {{ $t('account.rewards') }}</div>
            <div
              v-for="(i, k) in rewards"
              :key="`reward-${k}`"
              class="mr-1 mb-1 px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded text-xs"
            >
              {{ format.formatToken2(i) }}
            </div>
          </div>
          <div class="">
            <label
              for="withdraw_commission"
              class="modern-button w-full px-4 py-2 text-center"
              @click="
                dialog.open('withdraw_commission', {
                  validator_address: v.operator_address,
                })
              "
              >{{ $t('account.btn_withdraw') }}</label
            >
          </div>
        </div>
      </div>
      <div class="modern-card shadow-modern overflow-x-auto">
        <div class="px-6 pt-4 mb-2 text-gray-900 dark:text-white font-lg font-semibold">
          {{ $t('staking.addresses') }}
        </div>
        <div class="px-6 pb-4">
          <div class="mb-3">
            <div class="text-sm flex text-gray-700 dark:text-gray-300">{{ $t('staking.account_addr') }}
              <Icon
                  icon="mdi:content-copy"
                  class="ml-2 cursor-pointer text-purple-500 hover:text-purple-400"
                  v-show="addresses.account"
                  @click="copyWebsite(addresses.account || '')"
                />
              </div>
            <RouterLink
              class="text-xs text-epix-teal hover:text-epix-accent transition-colors duration-200"
              :to="`/${chain}/account/${addresses.account}`"
            >
              {{ addresses.account }}
            </RouterLink>
          </div>
          <div class="mb-3">
            <div class="text-sm flex text-gray-700 dark:text-gray-300">{{ $t('staking.operator_addr') }}
              <Icon
                  icon="mdi:content-copy"
                  class="ml-2 cursor-pointer text-purple-500 hover:text-purple-400"
                  v-show="v.operator_address"
                  @click="copyWebsite(v.operator_address || '')"
                /></div>
            <div class="text-xs text-gray-600 dark:text-gray-400">
              {{ v.operator_address }}
            </div>
          </div>
          <div class="mb-3">
            <div class="text-sm flex text-gray-700 dark:text-gray-300">{{ $t('staking.hex_addr') }}
              <Icon
                  icon="mdi:content-copy"
                  class="ml-2 cursor-pointer text-purple-500 hover:text-purple-400"
                  v-show="addresses.hex"
                  @click="copyWebsite(addresses.hex || '')"
                />
              </div>
            <div class="text-xs text-gray-600 dark:text-gray-400">{{ addresses.hex }}</div>
          </div>
          <div class="mb-3">
            <div class="text-sm flex text-gray-700 dark:text-gray-300">{{ $t('staking.signer_addr') }}
              <Icon
                  icon="mdi:content-copy"
                  class="ml-2 cursor-pointer text-purple-500 hover:text-purple-400"
                  v-show="addresses.valCons"
                  @click="copyWebsite(addresses.valCons || '')"
                />
              </div>
            <div class="text-xs text-gray-600 dark:text-gray-400">{{ addresses.valCons }}</div>
          </div>
          <div>
            <div class="text-sm flex text-gray-700 dark:text-gray-300">{{ $t('staking.consensus_pub_key') }}
              <Icon
                  icon="mdi:content-copy"
                  class="ml-2 cursor-pointer text-purple-500 hover:text-purple-400"
                  v-show="v.consensus_pubkey"
                  @click="copyWebsite(JSON.stringify(v.consensus_pubkey) || '')"
                />
              </div>
            <div class="text-xs text-gray-600 dark:text-gray-400">{{ v.consensus_pubkey }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="delegations.delegation_responses" class="mt-6 modern-card shadow-modern p-6">
      <div class="text-lg mb-4 font-semibold text-gray-900 dark:text-white">{{ $t('account.delegations') }}
        <span class="float-right text-gray-600 dark:text-gray-400"> {{ delegations.delegation_responses?.length || 0 }} / {{ delegations.pagination?.total || 0 }} </span>
      </div>
      <div class="rounded overflow-auto">
        <table class="table validatore-table w-full">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold" style="position: relative; z-index: 2">
              {{ $t('account.delegator') }}
            </th>
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold">{{ $t('account.delegation') }}</th>
          </thead>
          <tbody>
            <tr v-for="{balance, delegation} in delegations.delegation_responses" class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200">
              <td class="text-sm text-epix-teal hover:text-epix-accent transition-colors duration-200">
                {{ delegation.delegator_address }}
              </td>
              <td class="truncate text-gray-900 dark:text-white">
                {{ format.formatToken(balance)}}
              </td>

            </tr>
          </tbody>
        </table>
        <PaginationBar :total="delegations.pagination?.total" :limit="page.limit" :callback="pageload"/>
      </div>
    </div>

    <div class="mt-6 modern-card shadow-modern p-6">
      <div class="text-lg mb-4 font-semibold text-gray-900 dark:text-white">{{ $t('account.transactions') }}</div>
      <div class="rounded overflow-auto">
        <table class="table validatore-table w-full">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold" style="position: relative; z-index: 2">
              {{ $t('account.height') }}
            </th>
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold">{{ $t('account.hash') }}</th>
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold w-2/5">{{ $t('account.messages') }}</th>
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold">{{ $t('account.time') }}</th>
          </thead>
          <tbody>
            <tr v-for="(item, i) in txs.tx_responses" class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200">
              <td class="text-sm">
                <RouterLink :to="`/${props.chain}/block/${item.height}`" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">{{
                  item.height
                }}</RouterLink>
              </td>
              <td class="truncate max-w-xs">
                <RouterLink :to="`/${props.chain}/tx/${item.txhash}`" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">
                  {{ item.txhash }}
                </RouterLink>
              </td>
              <td>
                <div class="flex items-center text-gray-700 dark:text-gray-300">
                  <span class="mr-2">{{
                    format.messages(item.tx.body.messages)
                  }}</span>
                  <Icon
                    v-if="item.code === 0"
                    icon="mdi-check"
                    class="text-green-500"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-red-500" />
                </div>
              </td>
              <td class="w-36 text-gray-700 dark:text-gray-300">{{ format.toDay(item.timestamp, 'from') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="mt-6 modern-card shadow-modern p-6">
      <div class="text-lg mb-4 font-semibold text-gray-900 dark:text-white">
        <div class="tabs tabs-boxed bg-gray-100 dark:bg-gray-800">

                <span class="mr-10 text-gray-700 dark:text-gray-300">Voting Power Events: </span>
                <a
                    class="tab text-gray-600 dark:text-gray-400"
                    :class="{ 'tab-active bg-epix-primary text-white': selectedEventType === EventType.Delegate }"
                    @click="loadPowerEvents(1, EventType.Delegate)"
                    >{{ $t('account.btn_delegate') }}</a
                >
                <a
                    class="tab text-gray-600 dark:text-gray-400"
                    :class="{ 'tab-active bg-epix-primary text-white': selectedEventType === EventType.Unbond }"
                    @click="loadPowerEvents(1, EventType.Unbond)"
                    >{{ $t('account.btn_unbond') }}</a
                >
            </div>
      </div>
      <div class="rounded overflow-auto">
        <table class="table validatore-table w-full">
          <thead class="bg-gray-50 dark:bg-gray-800">
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold">{{ $t('account.delegator') }}</th>
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold">{{ $t('account.amount') }}</th>
            <th class="text-left pl-4 text-gray-700 dark:text-gray-300 font-semibold">{{ $t('account.height') }} / {{ $t('account.time') }}</th>
          </thead>
          <tbody>
            <tr v-for="(item, i) in events.tx_responses" class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200">
              <td class="pr-2 truncate max-w-xs">
                <RouterLink v-for="d in mapDelegators(item.tx?.body?.messages)" :to="`/${props.chain}/account/${d}`" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">
                  {{ d }}
                </RouterLink>
              </td>
              <td>
                <div class="flex items-center" :class="{
                  'text-green-500' : selectedEventType === EventType.Delegate,
                  'text-red-500' : selectedEventType ===  EventType.Unbond,
                }">
                  <RouterLink :to="`/${props.chain}/tx/${item.txhash}`" class="text-epix-teal hover:text-epix-accent transition-colors duration-200">
                    <span class="mr-2">
                      {{ (selectedEventType === EventType.Delegate ? '+' : '-')}} {{
                      mapEvents(item.events)
                    }}</span>
                  </RouterLink>
                  <Icon
                    v-if="item.code === 0"
                    icon="mdi-check"
                    class="text-green-500"
                  />
                  <Icon v-else icon="mdi-multiply" class="text-red-500" />
                </div>
              </td>
              <td class="w-36">
                <RouterLink class="text-epix-teal hover:text-epix-accent transition-colors duration-200 mb-0" :to="`/${props.chain}/block/${item.height}`">{{
                  item.height
                }}</RouterLink><br>
                <span class="text-xs pt-0 mt-0 text-gray-600 dark:text-gray-400">{{ format.toDay(item.timestamp, 'from') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <PaginationBar :total="events.pagination?.total" :limit="page.limit" :callback="pagePowerEvents"/>
      </div>
    </div>
    <!-- end -->
    <div class="toast" v-show="showCopyToast === 1">
      <div class="alert alert-success">
        <div class="text-xs md:!text-sm">
          <span>{{ tipMsg.msg }}</span>
        </div>
      </div>
    </div>
    <div class="toast" v-show="showCopyToast === 2">
      <div class="alert alert-error">
        <div class="text-xs md:!text-sm">
          <span>{{ tipMsg.msg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.validatore-table.table :where(th, td) {
  padding: 0.6rem 1rem;
  font-size: 14px;
}
</style>
