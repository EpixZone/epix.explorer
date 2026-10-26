<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBlockchain, useTxDialog, useWalletStore } from '@/stores';
import {
  DELEGATE, WITHDRAW, DIRECTORY_URL, REGISTRY_RAW, fetchJson, formatEpix,
  grantStatus, loadAccount, loadActivity, loadValidator, parseDirectory,
  parseOperator, parseRegistryEntry, record, validAddress,
  type CompoundAccount, type CompoundActivity, type CompoundGrant, type CompoundOperator,
} from '@/libs/autocompound';

const chain = useBlockchain();
const wallet = useWalletStore();
const dialog = useTxDialog();
const route = useRoute();
const chainId = computed(() => chain.current?.chainId || '');
const endpoint = computed(() => chain.endpoint?.address || '');
const owner = computed(() => typeof route.query.account === 'string' ? route.query.account : wallet.currentAddress);
const canManage = computed(() => !!owner.value && owner.value === wallet.currentAddress);
const operators = ref<CompoundOperator[]>([]);
const selected = ref('');
const search = ref('');
const delegatedOnly = ref(false);
const account = ref<CompoundAccount | null>(null);
const accountError = ref('');
const accountLoading = ref(false);
const registryNotice = ref('');
const registryLoading = ref(false);
const registryRevision = ref('');
const directoryFresh = ref(false);
const directoryCheckedAt = ref(0);
const checkedAt = ref(0);
const operatorFresh = ref(false);
const operatorError = ref('');
const validatorActive = ref<boolean | null>(null);
const activity = ref<CompoundActivity | null>(null);
const activityNotice = ref('');
const activityLoading = ref(false);
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 30000);
let registryRequest: AbortController | undefined;
let accountRequest: AbortController | undefined;
let operatorRequest: AbortController | undefined;
const selectedOperator = computed(() => operators.value.find(operator => operator.validator === selected.value));
const visibleOperators = computed(() => operators.value.filter(operator =>
  (operator.name + ' ' + operator.validator).toLowerCase().includes(search.value.toLowerCase()) &&
  (!delegatedOnly.value || !!account.value?.delegations[operator.validator])));
const selectedGrant = computed(() => account.value?.grants.find(grant =>
  grant.grantee === selectedOperator.value?.grantee && grant.messageType === DELEGATE));
const fresh = computed(() => operatorFresh.value && now.value - checkedAt.value < 5 * 60 * 1000);
const grantBlocker = computed(() => {
  if (registryLoading.value) return 'Wait for the registry refresh to finish.';
  if (!canManage.value) return 'Connect the account shown here to change its authorization.';
  if (accountLoading.value || !account.value) return 'Load current on-chain account status first.';
  if (account.value.unavailable.length) return 'Account checks are incomplete. Refresh before creating a grant.';
  if (!selectedOperator.value) return 'Select a validator.';
  if (!fresh.value) return 'Refresh the selected operator details before creating a grant.';
  if (validatorActive.value !== true) return 'The selected validator must be active and not jailed.';
  if (!account.value.delegations[selected.value] || account.value.delegations[selected.value] === '0') {
    return 'Delegate to this validator before enabling auto-compound.';
  }
  if (account.value.withdrawAddress !== owner.value) return 'The reward withdrawal address must match this account.';
  return '';
});
const relevantGrants = computed(() => account.value?.grants.filter(grant =>
  grant.messageType === DELEGATE || grant.messageType === WITHDRAW) || []);
const otherGrantCount = computed(() => (account.value?.grants.length || 0) - relevantGrants.value.length);
const otherGrants = computed(() => account.value?.grants.filter(grant =>
  grant.messageType !== DELEGATE && grant.messageType !== WITHDRAW) || []);
const reward = computed(() => account.value?.rewards[selected.value] || '0');
const belowThreshold = computed(() => selectedOperator.value &&
  BigInt(reward.value) < BigInt(selectedOperator.value.minimumReward));

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

async function refreshRegistry() {
  registryRequest?.abort();
  operatorRequest?.abort();
  const request = new AbortController();
  registryRequest = request;
  registryLoading.value = true;
  directoryFresh.value = false;
  operatorFresh.value = false;
  registryNotice.value = '';
  try {
    let snapshot: CompoundOperator[] = [];
    try {
      const saved = record(await fetchJson(new URL('autocompound/operators.json', document.baseURI).href, request.signal));
      if (!Array.isArray(saved.entries) || typeof saved.revision !== 'string' || !/^[0-9a-f]{40}$/.test(saved.revision)) {
        throw new Error('Invalid bundled registry');
      }
      registryRevision.value = saved.revision;
      snapshot = saved.entries.map(value => {
        const item = record(value);
        if (typeof item.path !== 'string' || !/^[A-Za-z0-9_.-]+\/chains\.json$/.test(item.path)) {
          throw new Error('Invalid bundled registry path');
        }
        return parseOperator({ ...record(item.chain), name: item.name }, REGISTRY_RAW + item.path, item.path);
      });
    } catch (error) {
      if (request.signal.aborted) return;
      registryNotice.value = 'Bundled registry unavailable: ' + message(error);
    }
    try {
      const listed = parseDirectory(await fetchJson(DIRECTORY_URL, request.signal));
      if (request.signal.aborted) return;
      operators.value = listed.map(operator => ({
        ...operator, registryPath: snapshot.find(item => item.validator === operator.validator)?.registryPath,
      }));
      directoryFresh.value = true;
      directoryCheckedAt.value = Date.now();
      registryNotice.value = 'Registry refreshed from cosmos.directory. Schedules are declared by operators.';
    } catch (error) {
      if (request.signal.aborted) return;
      operators.value = snapshot;
      registryNotice.value = 'Live directory unavailable. Showing the bundled registry; selected entries are checked directly on GitHub before authorization.';
    }
    operators.value.sort((a, b) => a.name.localeCompare(b.name));
    const requested = typeof route.query.validator === 'string' ? route.query.validator : '';
    if (!operators.value.some(operator => operator.validator === selected.value)) {
      selected.value = operators.value.find(operator => operator.validator === requested)?.validator ||
        operators.value[0]?.validator || '';
    }
    await refreshOperator();
  } finally {
    if (registryRequest === request) registryLoading.value = false;
  }
}

async function refreshAccount() {
  accountRequest?.abort();
  const request = new AbortController();
  accountRequest = request;
  account.value = null;
  accountError.value = '';
  accountLoading.value = false;
  if (!owner.value || !endpoint.value) return;
  if (!validAddress(owner.value, 'epix')) {
    accountError.value = 'Enter a valid Epix account address.';
    return;
  }
  accountLoading.value = true;
  try {
    const result = await loadAccount(endpoint.value, chainId.value, owner.value, request.signal);
    if (!request.signal.aborted) account.value = result;
  } catch (error) {
    if (!request.signal.aborted) accountError.value = message(error);
  } finally {
    if (accountRequest === request) accountLoading.value = false;
  }
}

async function refreshOperator() {
  operatorRequest?.abort();
  const request = new AbortController();
  operatorRequest = request;
  operatorFresh.value = false;
  operatorError.value = '';
  validatorActive.value = null;
  activity.value = null;
  activityNotice.value = '';
  activityLoading.value = false;
  const previous = selectedOperator.value;
  if (!previous || !endpoint.value) return;
  let current = previous;
  try {
    if (!directoryFresh.value || Date.now() - directoryCheckedAt.value >= 5 * 60 * 1000) {
      if (!previous.registryPath) throw new Error('Refresh the directory to verify this operator.');
      current = parseRegistryEntry(await fetchJson(REGISTRY_RAW + previous.registryPath, request.signal),
        previous.validator, previous.registryPath, previous.name);
      if (request.signal.aborted) return;
      operators.value = operators.value.map(operator => operator.validator === current.validator ? current : operator);
      checkedAt.value = Date.now();
      if (current.grantee !== previous.grantee) {
        operatorError.value = 'The registry operator address changed. Review the new address; old grants remain listed below.';
      }
    } else {
      checkedAt.value = directoryCheckedAt.value;
    }
    if (request.signal.aborted) return;
    operatorFresh.value = true;
    const active = await loadValidator(endpoint.value, current.validator, request.signal);
    if (request.signal.aborted) return;
    validatorActive.value = active;
  } catch (error) {
    if (!request.signal.aborted) operatorError.value = message(error);
  }
  if (request.signal.aborted) return;
  activityLoading.value = true;
  try {
    const result = await loadActivity(endpoint.value, current, request.signal);
    if (request.signal.aborted) return;
    activity.value = result;
    activityNotice.value = result ? 'Confirmed delegation in an operator transaction. This is not a live service check.' :
      'No matching successful delegation in the latest 20 operator transactions. Earlier activity may exist.';
  } catch {
    if (!request.signal.aborted) activityNotice.value = 'Transaction history is unavailable. Operator activity is unknown.';
  } finally {
    if (operatorRequest === request) activityLoading.value = false;
  }
}

function openGrant(event: Event) {
  if (grantBlocker.value || !selectedOperator.value || Date.now() - checkedAt.value >= 5 * 60 * 1000) {
    event.preventDefault(); return;
  }
  const operator = selectedOperator.value;
  dialog.open('autocompound', {
    expected_chain_id: chainId.value, validator_address: operator.validator,
    operator_address: operator.grantee, operator_name: operator.name,
    existing_grant: !!selectedGrant.value,
  }, refreshAccount);
}

function openRevoke(grant: CompoundGrant, event: Event) {
  if (!canManage.value || !account.value) { event.preventDefault(); return; }
  dialog.open('autocompound_revoke', {
    expected_chain_id: chainId.value, operator_address: grant.grantee,
    operator_name: operators.value.find(operator => operator.grantee === grant.grantee)?.name || '',
    message_type: grant.messageType,
  }, refreshAccount);
}

watch([owner, endpoint, chainId], () => { void refreshAccount(); void refreshOperator(); }, { immediate: true });
watch(selected, () => { void refreshOperator(); });
void refreshRegistry();
onBeforeUnmount(() => {
  clearInterval(clock);
  registryRequest?.abort(); accountRequest?.abort(); operatorRequest?.abort();
});
</script>

<template>
  <section class="space-y-5 pb-8">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <RouterLink to="/staking" class="text-sm text-epix-teal">Back to staking</RouterLink>
        <h1 class="text-2xl font-semibold mt-2">Auto-compound</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Validators run the compounding service and pay its transaction fees. Your browser can be closed.
        </p>
      </div>
      <button type="button" class="btn btn-outline btn-sm" :disabled="registryLoading || accountLoading"
        @click="refreshRegistry(); refreshAccount()">Refresh</button>
    </header>

    <div class="bg-base-100 rounded-xl p-5 space-y-3">
      <label v-if="!wallet.currentAddress" for="PingConnectWallet" class="btn btn-primary btn-sm">Connect wallet</label>
      <p v-if="owner" class="text-sm break-all"><strong>Account:</strong> {{ owner }}</p>
      <p v-if="owner && !canManage" class="text-sm">Viewing another account. Connect that account to change its grants.</p>
      <p class="text-sm"><strong>Chain:</strong> {{ chainId || 'Loading' }}</p>
      <p v-if="accountLoading" role="status">Loading on-chain permissions and rewards…</p>
      <p v-if="accountError" role="alert" class="text-error">Account status unavailable: {{ accountError }}</p>
      <p v-if="account" class="text-sm text-gray-500">Permissions checked at block {{ account.height }}.</p>
      <p v-if="account?.unavailable.length" role="alert" class="text-warning">
        Could not load {{ account.unavailable.join(', ') }}. Existing permissions can still be revoked.
      </p>
    </div>

    <div class="bg-base-100 rounded-xl p-5 space-y-4">
      <h2 class="text-lg font-semibold">Choose a validator service</h2>
      <p class="text-sm" role="status">{{ registryLoading ? 'Refreshing registry…' : registryNotice }}</p>
      <p v-if="registryRevision && !directoryFresh" class="text-xs break-all text-gray-500">
        Bundled registry revision: {{ registryRevision }}
      </p>
      <div class="flex flex-wrap gap-3 items-center">
        <input v-model="search" type="search" aria-label="Search validators" placeholder="Search validators"
          class="input input-bordered input-sm w-full sm:w-72" />
        <label class="flex gap-2 items-center text-sm">
          <input v-model="delegatedOnly" type="checkbox" class="checkbox checkbox-sm"
            :disabled="!account || account.unavailable.includes('delegations')" /> My delegations
        </label>
      </div>
      <label class="block">
        <span class="block text-sm mb-2">Validator</span>
        <select v-model="selected" class="select select-bordered w-full" :disabled="registryLoading">
          <option value="">Select a validator</option>
          <option v-for="operator in visibleOperators" :key="operator.validator" :value="operator.validator">
            {{ operator.name }}
          </option>
        </select>
      </label>
      <div v-if="selectedOperator" class="space-y-3 text-sm">
        <p class="break-all"><strong>Validator address:</strong> {{ selectedOperator.validator }}</p>
        <p class="break-all"><strong>Operator account receiving permission:</strong> {{ selectedOperator.grantee }}</p>
        <p><strong>Advertised schedule:</strong> {{ selectedOperator.schedule.join(', ') }} (fixed times are UTC)</p>
        <p><strong>Minimum reward:</strong> {{ formatEpix(selectedOperator.minimumReward) }} EPIX</p>
        <a :href="selectedOperator.source" target="_blank" rel="noopener noreferrer" class="text-epix-teal">
          View registry source
        </a>
        <p v-if="operatorError" role="alert" class="text-warning">{{ operatorError }}</p>
        <p v-if="validatorActive === false" class="text-warning">This validator is inactive or jailed.</p>
        <p v-if="account && !account.unavailable.includes('rewards')">
          Accrued rewards: {{ formatEpix(reward) }} EPIX.
          <span v-if="belowThreshold">Below the advertised threshold.</span>
        </p>
        <p v-if="selectedGrant"><strong>Permission:</strong> {{ grantStatus(selectedGrant, selected, now) }}</p>
        <p v-if="activityLoading" role="status">Checking recent operator transactions…</p>
        <p v-else>{{ activityNotice }}</p>
        <p v-if="activity">
          Last observed:
          <RouterLink :to="'/tx/' + activity.hash" class="text-epix-teal">{{ new Date(activity.timestamp).toLocaleString() }}</RouterLink>
          <span v-if="activity.delegator !== owner"> (for another delegator)</span>
        </p>
      </div>
      <div class="border-t border-base-300 pt-4 space-y-3">
        <p class="text-sm">
          You choose a cumulative EPIX allowance and expiration. The grant permits delegation of available funds
          within that allowance to the selected validator. Reward-only execution is the validator's service policy.
        </p>
        <p v-if="grantBlocker" class="text-sm text-warning">{{ grantBlocker }}</p>
        <label v-if="!grantBlocker" for="autocompound" class="btn btn-primary btn-sm" @click="openGrant">
          {{ selectedGrant ? 'Replace authorization' : 'Enable auto-compound' }}
        </label>
        <button v-else type="button" class="btn btn-primary btn-sm" disabled>Enable auto-compound</button>
        <RouterLink v-if="selected" :to="'/staking/' + selected" class="btn btn-ghost btn-sm">Validator and manual staking</RouterLink>
      </div>
    </div>

    <div class="bg-base-100 rounded-xl p-5 space-y-4">
      <h2 class="text-lg font-semibold">Existing authorizations</h2>
      <p class="text-sm">Revoking delegation permission stops future scheduled compounding. Closing this page does not stop a validator's service.</p>
      <p v-if="account && !relevantGrants.length">No delegation or legacy reward-withdrawal grants found.</p>
      <article v-for="grant in relevantGrants" :key="grant.grantee + grant.messageType"
        class="border border-base-300 rounded-lg p-4 space-y-2 text-sm">
        <p class="font-medium">{{ grant.messageType === DELEGATE ? 'Delegation permission' : 'Legacy reward-withdrawal permission' }}</p>
        <p class="break-all"><strong>Operator:</strong> {{ grant.grantee }}</p>
        <p><strong>Expires:</strong> {{ grant.expiration ? new Date(grant.expiration).toLocaleString() : 'No expiration' }}</p>
        <template v-if="grant.messageType === DELEGATE">
          <p><strong>Remaining cumulative allowance:</strong> {{
            grant.cap === null ? 'Unlimited or unspecified' :
            grant.capDenom === 'aepix' ? formatEpix(grant.cap) + ' EPIX' :
            grant.cap + ' ' + (grant.capDenom || '(unknown denomination)')
          }}</p>
          <p v-if="!grant.bounded" class="text-warning">This permission is broader than a new bounded auto-compound grant.</p>
          <p v-if="grant.validators.length" class="break-all"><strong>Allowed validators:</strong> {{ grant.validators.join(', ') }}</p>
          <p v-if="grant.deniedValidators.length" class="break-all"><strong>Excluded validators:</strong> {{ grant.deniedValidators.join(', ') }}</p>
        </template>
        <p v-else>Current REStake services do not need this old withdrawal permission.</p>
        <label v-if="canManage" for="autocompound_revoke" class="btn btn-error btn-outline btn-sm" @click="openRevoke(grant, $event)">Revoke this permission</label>
      </article>
      <details v-if="otherGrantCount" class="text-sm">
        <summary class="cursor-pointer">{{ otherGrantCount }} other authorizations (read only)</summary>
        <p class="mt-2">These permissions are outside auto-compound and will not be changed.</p>
        <div v-for="(grant, index) in otherGrants" :key="index" class="mt-3 break-all">
          <p><strong>Grantee:</strong> {{ grant.grantee }}</p>
          <p><strong>Permission:</strong> {{ grant.messageType || grant.authorizationType || 'Unknown' }}</p>
          <p><strong>Expires:</strong> {{ grant.expiration || 'No expiration' }}</p>
        </div>
      </details>
    </div>
  </section>
</template>
