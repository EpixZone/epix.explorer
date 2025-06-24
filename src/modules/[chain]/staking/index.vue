<script lang="ts" setup>
import {
    useBaseStore,
    useBlockchain,
    useFormatter,
    useMintStore,
    useStakingStore,
    useTxDialog,
} from '@/stores';
import { computed } from '@vue/reactivity';
import { onMounted, ref, watch, nextTick } from 'vue';
import { Icon } from '@iconify/vue';
import type { Key, SlashingParam, Validator } from '@/types';
import { formatSeconds}  from '@/libs/utils'
import { diff } from 'semver';

const staking = useStakingStore();
const base = useBaseStore();
const format = useFormatter();
const dialog = useTxDialog();
const chainStore = useBlockchain();
const mintStore = useMintStore()

const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});
const latest = ref({} as Record<string, number>);
const yesterday = ref({} as Record<string, number>);
const tab = ref('active');
const unbondList = ref([] as Validator[]);
const slashing = ref({} as SlashingParam)

// Loading and error states
const loading = ref(true);
const error = ref('');

// Create a local reactive copy of validators
const localValidators = ref([] as Validator[]);

// Create a reactive list that we'll update manually
const list = ref([] as any[]);

onMounted(async () => {
    try {
        loading.value = true;
        error.value = '';

        // Initialize local validators with current store data (for menu navigation)
        localValidators.value = [...staking.validators];
        updateList();

        // Fetch all required data
        await Promise.all([
            staking.fetchUnbondingValdiators().then((res) => {
                unbondList.value = res.concat(unbondList.value);
            }),
            staking.fetchInacitveValdiators().then((res) => {
                unbondList.value = unbondList.value.concat(res);
            }),
            chainStore.rpc.getSlashingParams().then(res => {
                slashing.value = res.params
            })
        ]);

        loading.value = false;
    } catch (err: any) {
        console.error('Error loading staking data:', err);
        error.value = 'Failed to load staking data. Please try another RPC endpoint.';
        loading.value = false;
    }

    // Add a timeout to prevent infinite loading
    setTimeout(() => {
        if (loading.value) {
            console.error('Staking data loading timeout');
            error.value = 'Loading timeout. Please try another RPC endpoint.';
            loading.value = false;
        }
    }, 30000); // 30 second timeout
});

// Watch for changes in validators and update local copy
watch(() => staking.validators, (newValidators) => {
    localValidators.value = [...newValidators]
    // Update the list after validators change
    nextTick(() => {
        updateList()
    })
}, { deep: true });

// Watch for tab changes and update list
watch(tab, () => {
    updateList()
});

// Watch for avatar changes and update list to refresh logos
watch(avatars, () => {
    updateList()
}, { deep: true });

async function fetchChange(blockWindow: number = 14400) {
    let page = 0;

    let height = Number(base.latest?.block?.header?.height || 0);
    if (height > blockWindow) {
        height -= blockWindow;
    } else {
        height = 1;
    }
    // voting power in 24h ago
    while (page < staking.validators.length && height > 0) {
        await base.fetchValidatorByHeight(height, page).then((x) => {
            x.validators.forEach((v) => {
                yesterday.value[v.pub_key.key] = Number(v.voting_power);
            });
        });
        page += 100;
    }

    page = 0;
    // voting power for now
    while (page < staking.validators.length) {
        await base.fetchLatestValidators(page).then((x) => {
            x.validators.forEach((v) => {
                latest.value[v.pub_key.key] = Number(v.voting_power);
            });
        });
        page += 100;
    }
}

const changes = computed(() => {
    const changes = {} as Record<string, number>;
    Object.keys(latest.value).forEach((k) => {
        const l = latest.value[k] || 0;
        const y = yesterday.value[k] || 0;
        changes[k] = l - y;
    });
    return changes;
});

const change24 = (entry: { consensus_pubkey: Key; tokens: string }) => {
    const txt = entry.consensus_pubkey.key;
    // const n: number = latest.value[txt];
    // const o: number = yesterday.value[txt];
    // // console.log( txt, n, o)
    // return n > 0 && o > 0 ? n - o : 0;

    const latestValue = latest.value[txt];
    if (!latestValue) {
        return 0;
    }

    const displayTokens = format.tokenAmountNumber({
        amount: parseInt(entry.tokens, 10).toString(),
        denom: staking.params.bond_denom,
    });
    const coefficient = displayTokens / latestValue;
    return changes.value[txt] * coefficient;
};

const change24Text = (entry: { consensus_pubkey: Key; tokens: string }) => {
    if (!entry) return '';
    const v = change24(entry);
    return v && v !== 0 ? format.showChanges(v) : '';
};

const change24Color = (entry: { consensus_pubkey: Key; tokens: string }) => {
    if (!entry) return '';
    const v = change24(entry);
    if (v > 0) return 'text-success';
    if (v < 0) return 'text-error';
};

const calculateRank = function (position: number) {
    let sum = 0;
    for (let i = 0; i < position; i++) {
        sum += Number(localValidators.value[i]?.delegator_shares);
    }
    const totalPower = localValidators.value.reduce((s, e) => s + parseInt(e.delegator_shares), 0);
    const percent = sum / totalPower;

    switch (true) {
        case tab.value === 'active' && percent < 0.33:
            return 'error';
        case tab.value === 'active' && percent < 0.67:
            return 'warning';
        default:
            return 'primary';
    }
};

function isFeatured(endpoints: string[], who?: {website?: string, moniker: string }) {
    if(!endpoints || !who) return false
    return endpoints.findIndex(x => who.website && who.website?.substring(0, who.website?.lastIndexOf('.')).endsWith(x) || who?.moniker?.toLowerCase().search(x.toLowerCase()) > -1) > -1
}

// Function to update the list based on current tab and validators
const updateList = () => {
    if (tab.value === 'active') {
        const result = localValidators.value.map((x, i) => ({v: x, rank: calculateRank(i), logo: logo(x.description.identity)}));
        list.value = result;
    } else if (tab.value === 'featured') {
        const endpoint = chainStore.current?.endpoints?.rest?.map(x => x.provider)
        if(endpoint) {
            endpoint.push('ping')
            const result = localValidators.value
                .filter(x => isFeatured(endpoint, x.description))
                .map((x, i) => ({v: x, rank: 'primary', logo: logo(x.description.identity)}));
            list.value = result;
        } else {
            list.value = [];
        }
    } else {
        const result = unbondList.value.map((x, i) => ({v: x, rank: 'primary', logo: logo(x.description.identity)}));
        list.value = result;
    }
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
        } else throw new Error(`failed to fetch avatar for ${identity}`);
      })
      .catch((error) => {
        // Avatar loading failed, but continue without error
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

const loadAvatars = () => {
  // fetches all avatars from keybase and stores it in localStorage
  const promises = staking.validators.map((validator) => {
    const identity = validator.description?.identity;

    // Here we also check whether we haven't already fetched the avatar
    if (identity && !avatars.value[identity]) {
      return fetchAvatar(identity);
    } else {
      return Promise.resolve();
    }
  });

  Promise.all(promises).then(() => {
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  });
};

const logo = (identity?: string) => {
    if (!identity || !avatars.value[identity]) return '';
    const url = avatars.value[identity] || '';
    return url.startsWith('http')
        ? url
        : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

const loaded = ref(false);
base.$subscribe((_, s) => {
    if (s.recents.length >= 2 && loaded.value === false) {
        loaded.value = true;
        const diff_time = Date.parse(s.recents[1].block.header.time) - Date.parse(s.recents[0].block.header.time)
        const diff_height = Number(s.recents[1].block.header.height) - Number(s.recents[0].block.header.height)
        const block_window = Number(Number(86400 * 1000 * diff_height / diff_time).toFixed(0))
        fetchChange(block_window);
    }
});

loadAvatars();
</script>
<template>
<div>
    <!-- Loading State -->
    <div v-if="loading">
        <!-- Stats Cards Skeleton -->
        <div class="modern-card shadow-modern grid sm:grid-cols-1 md:grid-cols-4 p-6 mb-6">
            <div v-for="i in 4" :key="i" class="flex items-center">
                <div class="w-12 h-12 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse mr-4"></div>
                <div>
                    <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2 w-20"></div>
                    <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24"></div>
                </div>
            </div>
        </div>

        <!-- Table Skeleton -->
        <div class="modern-card shadow-modern px-6 pt-4 pb-6">
            <div class="flex items-center justify-between py-4 mb-4">
                <div class="h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-64"></div>
                <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-16"></div>
            </div>

            <div class="overflow-x-auto">
                <table class="table w-full">
                    <thead class="bg-gray-50 dark:bg-gray-800">
                        <tr>
                            <th v-for="i in 6" :key="i" class="p-4">
                                <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="i in 10" :key="i" class="border-b border-gray-200 dark:border-gray-700">
                            <td class="p-4">
                                <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-8"></div>
                            </td>
                            <td class="p-4">
                                <div class="flex items-center">
                                    <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse mr-4"></div>
                                    <div>
                                        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2 w-32"></div>
                                        <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24"></div>
                                    </div>
                                </div>
                            </td>
                            <td class="p-4">
                                <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-20 ml-auto"></div>
                            </td>
                            <td class="p-4">
                                <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-16 ml-auto"></div>
                            </td>
                            <td class="p-4">
                                <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-12 ml-auto"></div>
                            </td>
                            <td class="p-4">
                                <div class="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-20 mx-auto"></div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="modern-card shadow-modern p-8 text-center mb-6">
        <div class="text-red-500 mb-4">
            <svg class="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Failed to Load Validators</h3>
            <p class="text-gray-600 dark:text-gray-400 mb-4">{{ error }}</p>
            <button
                @click="$router.go(0)"
                class="modern-button px-6 py-2 text-sm"
            >
                Try Again
            </button>
        </div>
    </div>

    <!-- Main Content -->
    <div v-else>
        <div class="modern-card shadow-modern grid sm:grid-cols-1 md:grid-cols-4 p-6 mb-6" >
        <div class="flex items-center">
            <span>
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4 bg-green-500/20">
                    <Icon class="text-green-400" icon="mdi:trending-up" size="24" />
                </div>
            </span>
            <span>
                <div class="font-bold text-gray-900 dark:text-white">{{ format.percent(mintStore.inflation) }}</div>
                <div class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.inflation') }}</div>
            </span>
        </div>
        <div class="flex items-center">
            <span>
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4 bg-purple-500/20">
                    <Icon class="text-purple-400" icon="mdi:lock-open-outline" size="24" />
                </div>
            </span>
            <span>
                <div class="font-bold text-gray-900 dark:text-white">{{ formatSeconds(staking.params?.unbonding_time) }}</div>
                <div class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.unbonding_time') }}</div>
            </span>
        </div>
        <div class="flex items-center">
            <span>
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4 bg-red-500/20">
                    <Icon class="text-red-400" icon="mdi:alert-octagon-outline" size="24" />
                </div>
            </span>
            <span>
            <div class="font-bold text-gray-900 dark:text-white">{{ format.percent(slashing.slash_fraction_double_sign) }}</div>
            <div class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.double_sign_slashing') }}</div>
            </span>
        </div>
        <div class="flex items-center">
            <span>
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center mr-4 bg-orange-500/20">
                    <Icon class="text-orange-400" icon="mdi:pause" size="24" />
                </div>
            </span>
            <span>
            <div class="font-bold text-gray-900 dark:text-white">{{ format.percent(slashing.slash_fraction_downtime) }}</div>
            <div class="text-sm text-gray-600 dark:text-gray-400">{{ $t('staking.downtime_slashing') }}</div>
            </span>
        </div>
    </div>

    <div>
        <div class="flex items-center justify-between py-4">
            <div class="tabs tabs-boxed bg-gray-100 dark:bg-gray-800">
                <a
                    class="tab text-gray-600 dark:text-gray-400"
                    :class="{ 'tab-active bg-epix-primary text-white': tab === 'featured' }"
                    @click="tab = 'featured'"
                    >{{ $t('staking.popular') }}</a
                >
                <a
                    class="tab text-gray-600 dark:text-gray-400"
                    :class="{ 'tab-active bg-epix-primary text-white': tab === 'active' }"
                    @click="tab = 'active'"
                    >{{ $t('staking.active') }}</a
                >
                <a
                    class="tab text-gray-600 dark:text-gray-400"
                    :class="{ 'tab-active bg-epix-primary text-white': tab === 'inactive' }"
                    @click="tab = 'inactive'"
                    >{{ $t('staking.inactive') }}</a
                >
            </div>

            <div class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ list.length }}/{{ staking.params.max_validators }}
            </div>
        </div>

        <div class="modern-card shadow-modern px-6 pt-4 pb-6">
            <div class="overflow-x-auto">
                <table class="table staking-table w-full">
                    <thead class="bg-gray-50 dark:bg-gray-800">
                        <tr>
                            <th
                                scope="col"
                                class="uppercase text-gray-700 dark:text-gray-300 font-semibold"
                                style="width: 3rem; position: relative"
                            >
                            {{ $t('staking.rank') }}
                            </th>
                            <th scope="col" class="uppercase text-gray-700 dark:text-gray-300 font-semibold">{{ $t('staking.validator') }}</th>
                            <th scope="col" class="text-right uppercase text-gray-700 dark:text-gray-300 font-semibold">{{ $t('staking.voting_power') }}</th>
                            <th scope="col" class="text-right uppercase text-gray-700 dark:text-gray-300 font-semibold">{{ $t('staking.24h_changes') }}</th>
                            <th scope="col" class="text-right uppercase text-gray-700 dark:text-gray-300 font-semibold">{{ $t('staking.commission') }}</th>
                            <th scope="col" class="text-center uppercase text-gray-700 dark:text-gray-300 font-semibold">{{ $t('staking.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="({v, rank, logo: validatorLogo}, i) in list"
                            :key="v.operator_address"
                            class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
                        >
                            <!-- 👉 rank -->
                            <td>
                                <div
                                    class="text-xs truncate relative px-2 py-1 rounded-full w-fit"
                                    :class="`text-${rank}`"
                                >
                                    <span
                                        class="inset-x-0 inset-y-0 opacity-10 absolute"
                                        :class="`bg-${rank}`"
                                    ></span>
                                    {{ i + 1 }}
                                </div>
                            </td>
                            <!-- 👉 Validator -->
                            <td>
                                <div
                                    class="flex items-center overflow-hidden"
                                    style="max-width: 300px"
                                >
                                    <div
                                        class="avatar mr-4 relative w-8 h-8 rounded-full"
                                    >
                                        <div
                                            class="w-8 h-8 rounded-full bg-gray-400 absolute opacity-10"
                                        ></div>
                                        <div class="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-gray-200 dark:bg-gray-700">
                                            <img
                                                v-if="validatorLogo"
                                                :src="validatorLogo"
                                                class="w-full h-full object-cover"
                                                @error="
                                                    (e) => {
                                                        const identity = v.description?.identity;
                                                        if (identity) {
                                                            loadAvatar(identity);
                                                        }
                                                        // Hide the broken image
                                                        e.target.style.display = 'none';
                                                    }
                                                "
                                                @load="(e) => e.target.style.display = 'block'"
                                            />
                                            <Icon
                                                v-if="!validatorLogo"
                                                class="text-2xl text-gray-400"
                                                icon="mdi:account-circle"
                                            />

                                        </div>
                                    </div>

                                    <div class="flex flex-col">
                                        <span class="text-sm whitespace-nowrap overflow-hidden">
                                            <RouterLink
                                                :to="{
                                                    name: 'chain-staking-validator',
                                                    params: {
                                                        validator:
                                                            v.operator_address,
                                                    },
                                                }"
                                                class="font-weight-medium text-epix-teal hover:text-epix-accent transition-colors duration-200"
                                            >
                                                {{ v.description?.moniker }}
                                            </RouterLink>
                                        </span>
                                        <span class="text-xs text-gray-600 dark:text-gray-400">{{
                                            v.description?.website ||
                                            v.description?.identity ||
                                            '-'
                                        }}</span>
                                    </div>
                                </div>
                            </td>

                            <!-- 👉 Voting Power -->
                            <td class="text-right">
                                <div class="flex flex-col">
                                    <h6 class="text-sm font-weight-medium whitespace-nowrap text-gray-900 dark:text-white">
                                        {{
                                            format.formatToken(
                                                {
                                                    amount: parseInt(
                                                        v.tokens
                                                    ).toString(),
                                                    denom: staking.params
                                                        .bond_denom,
                                                },
                                                true,
                                                '0,0'
                                            )
                                        }}
                                    </h6>
                                    <span class="text-xs text-gray-600 dark:text-gray-400">{{
                                        format.calculatePercent(
                                            v.delegator_shares,
                                            staking.totalPower
                                        )
                                    }}</span>
                                </div>
                            </td>
                            <!-- 👉 24h Changes -->
                            <td
                                class="text-right text-xs"
                                :class="change24Color(v)"
                            >
                                {{ change24Text(v) }}
                            </td>
                            <!-- 👉 commission -->
                            <td class="text-right text-xs text-gray-900 dark:text-white">
                                {{
                                    format.formatCommissionRate(
                                        v.commission?.commission_rates?.rate
                                    )
                                }}
                            </td>
                            <!-- 👉 Action -->
                            <td class="text-center">
                                <div
                                    v-if="v.jailed"
                                    class="badge badge-error gap-2 text-white"
                                >
                                {{ $t('staking.jailed') }}
                                </div>
                                <label
                                    v-else
                                    for="delegate"
                                    class="modern-button !text-xs px-3 py-1 rounded-sm capitalize"
                                    @click="
                                        dialog.open('delegate', {
                                            validator_address:
                                                v.operator_address,
                                        })
                                    "
                                    >{{ $t('account.btn_delegate') }}</label
                                >
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="divider border-gray-200 dark:border-gray-700"></div>
            <div class="flex flex-row items-center">
                <div
                    class="text-xs truncate relative py-2 px-4 rounded-lg w-fit text-red-600 dark:text-red-400 mr-2 bg-red-50 dark:bg-red-900/20"
                >
                    {{ $t('staking.top') }} 33%
                </div>
                <div
                    class="text-xs truncate relative py-2 px-4 rounded-lg w-fit text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20"
                >
                    {{ $t('staking.top') }} 67%
                </div>
                <div class="text-xs hidden md:!block pl-2 text-gray-600 dark:text-gray-400">
                    {{ $t('staking.description') }}
                </div>
            </div>
        </div>
    </div>
    </div> <!-- End of main content -->
</div>
</template>

<route>
  {
    meta: {
      i18n: 'staking',
      order: 3
    }
  }
</route>

<style>
.staking-table.table :where(th, td) {
    padding: 8px 5px;
    background: transparent;
}
</style>
