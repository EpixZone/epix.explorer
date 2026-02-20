<script lang="ts" setup>
import { computed, ref, reactive, watchEffect } from 'vue';
import MdEditor from 'md-editor-v3';
import ObjectElement from '@/components/dynamic/ObjectElement.vue';
import {
  useBaseStore,
  useBlockchain,
  useFormatter,
  useGovStore,
  useStakingStore,
  useTxDialog,
} from '@/stores';
import {
  PageRequest,
  type GovProposal,
  type GovVote,
  type PaginatedProposalDeposit,
  type Pagination,
} from '@/types';
import Countdown from '@/components/Countdown.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import { fromBech32, toHex } from '@cosmjs/encoding';

const props = defineProps(['proposal_id', 'chain']);
const proposal = ref({
  final_tally_result: {
    yes: '0',
    no: '0',
    abstain: '0',
    no_with_veto: '0'
  }
} as GovProposal);

// Create separate reactive refs for tally data
const tallyData = ref({
  yes: '0',
  no: '0',
  abstain: '0',
  no_with_veto: '0'
});

const format = useFormatter();
const store = useGovStore();
const dialog = useTxDialog();
const stakingStore = useStakingStore();
const chainStore = useBlockchain();

store.fetchProposal(props.proposal_id).then((res) => {
  let proposalDetail = reactive(res.proposal);
  proposal.value = proposalDetail;

  // Always fetch tally data to ensure it's in the correct format
  console.log('Fetching tally for proposal:', props.proposal_id);
  store.fetchTally(props.proposal_id).then((tallRes) => {
    if (tallRes?.tally) {
      // Update both the proposal and separate tally data
      Object.assign(proposal.value.final_tally_result, tallRes.tally);
      // Replace the entire ref to force reactivity
      tallyData.value = { ...tallRes.tally };
    }
  }).catch((error) => {
    console.error('Error fetching tally:', error);
  });

  // load origin params if the proposal is param change
  if (proposalDetail.content?.changes) {
    proposalDetail.content?.changes.forEach((item) => {
      chainStore.rpc.getParams(item.subspace, item.key).then((res) => {
        if (proposal.value.content && res.param) {
          if (proposal.value.content.current) {
            proposal.value.content.current.push(res.param);
          } else {
            proposal.value.content.current = [res.param];
          }
        }
      });
    });
  }

  const msgType = proposalDetail.content?.['@type'] || '';
  if (msgType.endsWith('MsgUpdateParams')) {
    if (msgType.indexOf('staking') > -1) {
      chainStore.rpc.getStakingParams().then((res) => {
        addCurrentParams(res);
      });
    } else if (msgType.indexOf('gov') > -1) {
      chainStore.rpc.getGovParamsVoting().then((res) => {
        addCurrentParams(res);
      });
    } else if (msgType.indexOf('distribution') > -1) {
      chainStore.rpc.getDistributionParams().then((res) => {
        addCurrentParams(res);
      });
    } else if (msgType.indexOf('slashing') > -1) {
      chainStore.rpc.getSlashingParams().then((res) => {
        addCurrentParams(res);
      });
    }
  }
});

function addCurrentParams(res: any) {
  if (proposal.value.content && res.params) {
    proposal.value.content.params = [proposal.value.content?.params];
    proposal.value.content.current = [res.params];
  }
}
const color = computed(() => {
  if (proposal.value.status === 'PROPOSAL_STATUS_PASSED') {
    return 'success';
  } else if (proposal.value.status === 'PROPOSAL_STATUS_REJECTED') {
    return 'error';
  }
  return '';
});
const status = computed(() => {
  if (proposal.value.status) {
    return proposal.value.status.replace('PROPOSAL_STATUS_', '');
  }
  return '';
});



const deposit = ref({} as PaginatedProposalDeposit);
store.fetchProposalDeposits(props.proposal_id).then((x) => (deposit.value = x));

const votes = ref({} as GovVote[]);
const pageRequest = ref(new PageRequest());
const pageResponse = ref({} as Pagination);

store.fetchProposalVotes(props.proposal_id).then((x) => {
  votes.value = x.votes;
  pageResponse.value = x.pagination;
});

function shortTime(v: string) {
  if (v) {
    return format.toDay(v, 'from');
  }
  return '';
}

const votingCountdown = computed((): number => {
  const now = new Date();
  const end = new Date(proposal.value.voting_end_time);
  return end.getTime() - now.getTime();
});

const upgradeCountdown = computed((): number => {
  const height = Number(proposal.value.content?.plan?.height || 0);
  if (height > 0) {
    const base = useBaseStore();
    const current = Number(base.latest?.block?.header?.height || 0);
    return (
      (height - current) * Number((base.blocktime / 1000).toFixed()) * 1000
    );
  }
  const now = new Date();
  const end = new Date(proposal.value.content?.plan?.time || '');
  return end.getTime() - now.getTime();
});

// Use a simple ref instead of computed
const total = ref(0);

// Use watchEffect to update the total when tallyData changes
watchEffect(() => {
  const tally = tallyData.value;

  const yesNum = Number(tally.yes || 0);
  const noNum = Number(tally.no || 0);
  const abstainNum = Number(tally.abstain || 0);
  const vetoNum = Number(tally.no_with_veto || 0);

  const sum = yesNum + noNum + abstainNum + vetoNum;
  total.value = sum;
});

// Use ref instead of computed for turnout
const turnout = ref(0);

// Update turnout when total changes
watchEffect(() => {
  if (total.value > 0) {
    const bonded = stakingStore.pool?.bonded_tokens || '1';
    turnout.value = format.percent(total.value / Number(bonded));
  } else {
    turnout.value = 0;
  }
});

// Use refs instead of computed for percentage calculations
const yes = ref(0);
const no = ref(0);
const veto = ref(0);
const abstain = ref(0);

// Update percentages when total or tallyData changes
watchEffect(() => {
  if (total.value > 0) {
    const yesValue = Number(tallyData.value.yes || 0);
    const noValue = Number(tallyData.value.no || 0);
    const vetoValue = Number(tallyData.value.no_with_veto || 0);
    const abstainValue = Number(tallyData.value.abstain || 0);

    yes.value = format.percent(yesValue / total.value);
    no.value = format.percent(noValue / total.value);
    veto.value = format.percent(vetoValue / total.value);
    abstain.value = format.percent(abstainValue / total.value);
  } else {
    yes.value = 0;
    no.value = 0;
    veto.value = 0;
    abstain.value = 0;
  }
});
// Use ref instead of computed for processList
const processList = ref([
  { name: 'Turnout', value: '0%', class: 'bg-info' },
  { name: 'Yes', value: '0%', class: 'bg-success' },
  { name: 'No', value: '0%', class: 'bg-error' },
  { name: 'No With Veto', value: '0%', class: 'bg-red-800' },
  { name: 'Abstain', value: '0%', class: 'bg-gray-400' },
]);

// Update processList when percentage values change
watchEffect(() => {
  processList.value = [
    { name: 'Turnout', value: turnout.value, class: 'bg-info' },
    { name: 'Yes', value: yes.value, class: 'bg-success' },
    { name: 'No', value: no.value, class: 'bg-error' },
    { name: 'No With Veto', value: veto.value, class: 'bg-red-800' },
    { name: 'Abstain', value: abstain.value, class: 'bg-warning' },
  ];
});

function showValidatorName(voter: string) {
  try {
    const { data } = fromBech32(voter);
    const hex = toHex(data);
    const v = stakingStore.validators.find((x) => toHex(fromBech32(x.operator_address).data) === hex);
    return v ? v.description.moniker : voter;
  } catch (e) {
    return voter;
  }
}

function pageload(p: number) {
  pageRequest.value.setPage(p);
  store.fetchProposalVotes(props.proposal_id, pageRequest.value).then((x) => {
    votes.value = x.votes;
    pageResponse.value = x.pagination;
  });
}

const contentWithoutDescription = computed(() => {
  if (!proposal.value.content) return undefined;
  if (!proposal.value.summary && !proposal.value.content.description) return proposal.value.content;
  const { description, ...rest } = proposal.value.content;
  return rest;
});

function metaItem(metadata: string | undefined): { title: string; summary: string } {
  if (!metadata) {
    return { title: '', summary: '' };
  } else if (metadata.startsWith('{') && metadata.endsWith('}')) {
    return JSON.parse(metadata);
  }
  return { title: metadata, summary: '' };
}
</script>

<template>
  <div>
    <div class="modern-card px-4 pt-3 pb-4 mb-4 shadow-modern">
      <h2 class="flex flex-col md:!justify-between md:!flex-row mb-2 text-lg font-semibold">
        <p class="truncate w-full text-gray-900 dark:text-white">
          {{ proposal_id }}. {{ proposal.title || proposal.content?.title || metaItem(proposal?.metadata)?.title  }}
        </p>
        <div
          class="px-3 py-1 rounded-full text-sm font-medium"
          :class="
            color === 'success'
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : color === 'error'
              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
          "
        >
          {{ status }}
        </div>
      </h2>
      <div class="">
        <ObjectElement :value="contentWithoutDescription" />
      </div>
      <div v-if="proposal.summary || proposal.content?.description" class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <MdEditor
          :model-value="
            format.multiLine(
              proposal.summary || proposal.content?.description
            )
          "
          previewOnly
          class="md-editor-recover"
        ></MdEditor>
      </div>
    </div>
    <!-- grid lg:!!grid-cols-3 auto-rows-max-->
    <!-- flex-col lg:!!flex-row flex -->
    <div class="gap-4 mb-4 grid lg:!!grid-cols-3 auto-rows-max">
      <!-- flex-1 -->
      <div class="modern-card px-4 pt-3 pb-4 shadow-modern">
        <h2 class="text-lg font-semibold mb-3 text-gray-900 dark:text-white">{{ $t('gov.tally') }}</h2>

        <div class="mb-1" v-for="(item, index) of processList" :key="index">
          <div class="block text-sm mb-1 text-gray-700 dark:text-gray-300">{{ item.name }}</div>
          <div class="h-5 w-full relative">
            <div class="absolute inset-x-0 inset-y-0 w-full opacity-10 rounded-sm" :class="`${item.class}`"></div>
            <div
              class="absolute inset-x-0 inset-y-0 rounded-sm"
              :class="`${item.class}`"
              :style="`width: ${item.value === '-' || item.value === 'NaN%' ? '0%' : item.value}`"
            ></div>
            <p
              class="absolute inset-x-0 inset-y-0 text-center text-sm text-gray-700 dark:text-gray-200 flex items-center justify-center"
            >
              {{ item.value }}
            </p>
          </div>
        </div>
        <div class="mt-6 grid grid-cols-2 gap-2">
          <label
            for="vote"
            class="modern-button px-4 py-2 text-sm cursor-pointer text-center"
            @click="dialog.open('vote', { proposal_id })"
            >{{ $t('gov.btn_vote') }}</label
          >
          <label
            for="deposit"
            class="modern-button px-4 py-2 text-sm cursor-pointer text-center"
            @click="dialog.open('deposit', { proposal_id })"
            >{{ $t('gov.btn_deposit') }}</label
          >
        </div>
      </div>

      <div class="modern-card px-4 pt-3 pb-5 shadow-modern lg:!!col-span-2">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('gov.timeline') }}</h2>

        <div class="px-1">
          <div class="flex items-center mb-4 mt-2">
            <div class="w-2 h-2 rounded-full bg-red-500 mr-3"></div>
            <div class="text-base flex-1 text-gray-900 dark:text-white">
              {{ $t('gov.submit_at') }}: {{ format.toDay(proposal.submit_time) }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">{{ shortTime(proposal.submit_time) }}</div>
          </div>
          <div class="flex items-center mb-4">
            <div class="w-2 h-2 rounded-full bg-epix-primary mr-3"></div>
            <div class="text-base flex-1 text-gray-900 dark:text-white">
              {{ $t('gov.deposited_at') }}:
              {{
                format.toDay(
                  proposal.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
                    ? proposal.deposit_end_time
                    : proposal.voting_start_time
                )
              }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">
              {{
                shortTime(
                  proposal.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
                    ? proposal.deposit_end_time
                    : proposal.voting_start_time
                )
              }}
            </div>
          </div>
          <div class="mb-4">
            <div class="flex items-center">
              <div class="w-2 h-2 rounded-full bg-green-500 mr-3"></div>
              <div class="text-base flex-1 text-gray-900 dark:text-white">
                {{ $t('gov.vote_start_from') }} {{ format.toDay(proposal.voting_start_time) }}
              </div>
              <div class="text-sm text-gray-600 dark:text-gray-400">
                {{ shortTime(proposal.voting_start_time) }}
              </div>
            </div>
            <div class="pl-5 text-sm mt-2">
              <Countdown :time="votingCountdown" />
            </div>
          </div>
          <div>
            <div class="flex items-center mb-1">
              <div class="w-2 h-2 rounded-full bg-green-600 mr-3"></div>
              <div class="text-base flex-1 text-gray-900 dark:text-white">
                {{ $t('gov.vote_end') }} {{ format.toDay(proposal.voting_end_time) }}
              </div>
              <div class="text-sm text-gray-600 dark:text-gray-400">
                {{ shortTime(proposal.voting_end_time) }}
              </div>
            </div>
            <div class="pl-5 text-sm text-gray-700 dark:text-gray-300">
              {{ $t('gov.current_status') }}: {{ $t(`gov.proposal_statuses.${proposal.status}`) }}
            </div>
          </div>

          <div class="mt-4" v-if="proposal?.content?.['@type']?.endsWith('SoftwareUpgradeProposal')">
            <div class="flex items-center">
              <div class="w-2 h-2 rounded-full bg-warning mr-3"></div>
              <div class="text-base flex-1 text-main">
                {{ $t('gov.upgrade_plan') }}:
                <span v-if="Number(proposal.content?.plan?.height || '0') > 0"> (EST)</span>
                <span v-else>{{ format.toDay(proposal.content?.plan?.time) }}</span>
              </div>
              <div class="text-sm">
                {{ shortTime(proposal.voting_end_time) }}
              </div>
            </div>
            <div class="pl-5 text-sm mt-2">
              <Countdown :time="upgradeCountdown" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="modern-card px-4 pt-3 pb-4 mb-4 shadow-modern">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">{{ $t('gov.votes') }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="text-left py-2 text-sm font-medium text-gray-700 dark:text-gray-300">Voter</th>
              <th class="text-left py-2 text-sm font-medium text-gray-700 dark:text-gray-300">Vote</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) of votes" :key="index" class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-epix-gray-light transition-colors duration-200">
              <td class="py-2 text-sm text-gray-900 dark:text-white">{{ showValidatorName(item.voter) }}</td>
              <td
                v-if="item.option && item.option !== 'VOTE_OPTION_UNSPECIFIED'"
                class="py-2 text-sm"
                :class="{
                  'text-green-600 dark:text-green-400': item.option === 'VOTE_OPTION_YES',
                  'text-red-600 dark:text-red-400': item.option === 'VOTE_OPTION_NO',
                  'text-gray-600 dark:text-gray-400': item.option === 'VOTE_OPTION_ABSTAIN',
                }"
              >
                {{ String(item.option).replace('VOTE_OPTION_', '') }}
              </td>
              <td
                v-if="item.options"
                class="py-2 text-sm text-gray-900 dark:text-white"
              >
                {{ item.options.map((x) => `${x.option.replace('VOTE_OPTION_', '')}:${format.percent(x.weight)}`).join(', ') }}
              </td>
            </tr>
          </tbody>
        </table>
        <PaginationBar :limit="pageRequest.limit" :total="pageResponse.total" :callback="pageload" />
      </div>
    </div>
  </div>
</template>
