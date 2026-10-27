<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useBlockchain, useStakingStore, useTxDialog, useWalletStore } from '@/stores';
import type { Validator } from '@/types';
import {
  DELEGATE, WITHDRAW, DIRECTORY_URL, REGISTRY_RAW, STATUS_ICONS, activityHealth,
  delegationStatus, fetchJson, formatAmount, formatDate, formatDateTime, formatFixed, formatUtc, grantCovers, grantLive,
  humanMessageType, humanSchedule, humanThreshold, intervalHours, leftoverStatus, loadAccount, loadActivityPage, loadApr,
  loadUnbondingSeconds, loadValidator, notRunning, parseDirectory, parseOperator, parsePendingAuthorization, parseRegistryEntry,
  pendingAuthorizationKey, plural, record, relativeTime, scheduleText, shortAddress, statusGroup, validAddress,
  validatorApr,
  type CompoundAccount, type CompoundActivity, type CompoundGrant, type CompoundOperator, type DelegationStatus,
  type GrantIntent, type LastRun, type RegistryState, type StatusAction, type StatusGroup, type ValidatorDetails,
} from '@/libs/autocompound';

// ---------------------------------------------------------------------------
// Stores. The component tests run setup() with a fixture that provides only
// the wallet, chain and dialog stores and `useRoute`, so everything else is
// optional and resolved defensively (spec 10.7).
// ---------------------------------------------------------------------------
function optional<T>(factory: unknown): T | null {
  try {
    return typeof factory === 'function' ? (factory as () => T)() : null;
  } catch {
    return null;
  }
}

type StoreValidator = Partial<Validator> & { operator_address: string };
interface StakingLike { validators?: StoreValidator[]; keybase?: (identity: string) => Promise<unknown> }
interface RouterLike { replace: (to: unknown) => unknown }
interface DialogLike {
  openAndShow: (type: string, params: unknown, callback?: (result?: unknown) => void) => void;
  dialogOpen?: boolean;
}

const chain = useBlockchain();
const wallet = useWalletStore();
const dialog = useTxDialog() as unknown as DialogLike;
const route = useRoute();
const router = optional<RouterLike>(useRouter);
const staking = optional<StakingLike>(useStakingStore);

const SUPPORTED_WALLETS = ['Keplr', 'Leap', 'MetamaskSnap'];
const FRESH_MS = 5 * 60 * 1000;
const chainId = computed(() => chain.current?.chainId || '');
const endpoint = computed(() => chain.endpoint?.address || '');
const queryAccount = computed(() => typeof route.query.account === 'string' ? route.query.account : '');
const focusedQuery = computed(() => validAddress(route.query.validator, 'epixvaloper') ? route.query.validator : '');
const owner = computed(() => queryAccount.value || wallet.currentAddress);
const canManage = computed(() => !!owner.value && owner.value === wallet.currentAddress);
const walletName = computed(() => {
  try {
    const connected = (wallet as unknown as { connectedWallet?: { wallet?: unknown } }).connectedWallet;
    return typeof connected?.wallet === 'string' ? connected.wallet : '';
  } catch {
    return '';
  }
});
const walletSupported = computed(() => !walletName.value || SUPPORTED_WALLETS.includes(walletName.value));
const actionsAllowed = computed(() => canManage.value && walletSupported.value);
const dialogOpen = computed(() => dialog.dialogOpen === true);
const noWallet = computed(() => !wallet.currentAddress && !queryAccount.value);

// ---------------------------------------------------------------------------
// Script-level state (names kept for the regression suite, spec 7.7)
// ---------------------------------------------------------------------------
const operators = ref<CompoundOperator[]>([]);
const selected = ref('');
const account = ref<CompoundAccount | null>(null);
const accountOwner = ref('');
const accountError = ref('');
const accountInvalid = ref(false);
const accountLoading = ref(false);
const accountStale = ref(false);
const accountLoadedAt = ref(0);
const registryLoading = ref(false);
const registryResult = ref<'' | 'ready' | 'unavailable'>('');
const registryNotice = ref<'' | 'bundled' | 'unavailable'>('');
const registryRevision = ref('');
const registryCreatedAt = ref('');
const registryError = ref('');
const directoryFresh = ref(false);
const directoryCheckedAt = ref(0);
const checkedAt = ref(0);
const operatorFresh = ref(false);
const operatorError = ref('');
const operatorPhase = ref<'idle' | 'checking' | 'done'>('idle');
const validatorActive = ref<boolean | null>(null);
const validatorDetails = ref<Record<string, ValidatorDetails>>({});
// Last observed re-stake per service account (A16, extended to every card and
// every offer); see the "Service health" section. `activity`, `activityState`,
// `activityValidator` and `activityLoading` below derive from this same map,
// so the deep check of the selected row and the batch can never disagree.
interface ActivityEntry {
  state: 'loading' | 'done' | 'unavailable';
  activity: CompoundActivity | null;
  txCount: number | null;
  checkedAt: number;
}
const activityMap = ref<Record<string, ActivityEntry>>({});
const apr = ref('');
const unbondingSeconds = ref('');
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 30000);
let registryRequest: AbortController | undefined;
let accountRequest: AbortController | undefined;
let operatorRequest: AbortController | undefined;
let paramsRequest: AbortController | undefined;

const registryState = computed<RegistryState>(() => {
  if (registryResult.value === 'ready') return 'ready';
  if (registryResult.value === 'unavailable' && !registryLoading.value) return 'unavailable';
  return 'loading';
});
const operatorByValidator = computed(() => {
  const map: Record<string, CompoundOperator> = {};
  for (const operator of operators.value) map[operator.validator] = operator;
  return map;
});
const selectedOperator = computed(() => operators.value.find(operator => operator.validator === selected.value));
const selectedGrant = computed(() => account.value?.grants.find(grant =>
  grant.grantee === selectedOperator.value?.grantee && grant.messageType === DELEGATE && grantCovers(grant, selected.value)));
const selectedActivity = computed(() => selectedOperator.value ? activityMap.value[selectedOperator.value.grantee] || null : null);
const activityValidator = computed(() => selectedOperator.value?.validator || '');
const activityLoading = computed(() => !!selectedOperator.value && (!selectedActivity.value || selectedActivity.value.state === 'loading'));
const activity = computed(() => selectedActivity.value?.state === 'done' ? selectedActivity.value.activity : null);
const activityState = computed<'' | 'found' | 'none' | 'unavailable'>(() => {
  const entry = selectedActivity.value;
  if (!entry || entry.state === 'loading') return '';
  if (entry.state === 'unavailable') return 'unavailable';
  return entry.activity ? 'found' : 'none';
});
const fresh = computed(() => operatorFresh.value && now.value - checkedAt.value < FRESH_MS);
const relevantGrants = computed(() => account.value?.grants.filter(grant =>
  grant.messageType === DELEGATE || grant.messageType === WITHDRAW) || []);
const otherGrants = computed(() => account.value?.grants.filter(grant =>
  grant.messageType !== DELEGATE && grant.messageType !== WITHDRAW) || []);
const withdrawGrants = computed(() => relevantGrants.value.filter(grant => grant.messageType === WITHDRAW));
const delegateGrants = computed(() => account.value?.grants.filter(grant => grant.messageType === DELEGATE) || []);

// Blocker causes and their order are unchanged (spec 7.2); only the strings
// and the row-level rendering are new (A03).
type BlockerCause = '' | 'loading' | 'wallet' | 'unavailable' | 'gone' | 'fresh' | 'inactive' | 'delegation' | 'withdraw';
const blockerCause = computed<BlockerCause>(() => {
  if (registryLoading.value) return 'loading';
  if (!canManage.value) return 'wallet';
  if (accountLoading.value || !account.value) return 'loading';
  if (account.value.unavailable.length) return 'unavailable';
  if (!selectedOperator.value) return 'gone';
  if (!fresh.value) return 'fresh';
  if (validatorActive.value !== true) return 'inactive';
  if (!account.value.delegations[selected.value] || account.value.delegations[selected.value] === '0') return 'delegation';
  if (account.value.withdrawAddress !== owner.value) return 'withdraw';
  return '';
});
const grantBlocker = computed(() => blockerText(blockerCause.value, selected.value));

function unavailableWords(items: string[]): string {
  const words = items.map(item => item === 'delegations' ? 'your stakes' : item === 'rewards' ? 'your rewards' : 'where your rewards are paid');
  return words.length <= 1 ? words.join('') : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}

const withdrawNotice = computed(() => {
  const current = account.value;
  if (!current || !current.withdrawAddress || current.withdrawAddress === owner.value) return '';
  return 'Your rewards go to ' + shortAddress(current.withdrawAddress) + " instead of this account, so a service can't re-stake them. " +
    "Wallets can't change this: use the Epix CLI (epixd tx distribution set-withdraw-addr) to point rewards back to this account, " +
    'then press Refresh. Turning auto-compound off still works.';
});

function blockerText(cause: BlockerCause, validator: string): string {
  const name = nameOf(validator);
  switch (cause) {
    case 'loading': return 'Checking…';
    case 'wallet': return 'Connect this wallet to make changes.';
    case 'unavailable':
      return "Couldn't load " + unavailableWords(account.value?.unavailable || []) +
        ", so auto-compound can't be turned on right now. You can still turn it off.";
    case 'gone': return name + ' is no longer listed as running an auto-compound service.';
    case 'fresh':
      return /no longer/.test(operatorError.value)
        ? name + ' is no longer listed as running an auto-compound service.'
        : "Couldn't verify " + name + "'s service listing right now.";
    case 'inactive':
      return name + " is jailed or not in the active set, so it isn't earning rewards to compound. Try again once it's active.";
    case 'delegation': return "You haven't staked with " + name + ' yet.';
    case 'withdraw': return withdrawNotice.value || 'Your rewards are paid to a different address. Auto-compound needs them paid to this account.';
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Names, avatars and per-validator data
// ---------------------------------------------------------------------------
const AVATAR_COLOURS = [
  'bg-indigo-600 text-white', 'bg-teal-700 text-white', 'bg-rose-700 text-white', 'bg-amber-700 text-white',
  'bg-emerald-700 text-white', 'bg-sky-700 text-white', 'bg-purple-700 text-white', 'bg-slate-700 text-white',
];
const avatars = ref<Record<string, string>>(readAvatars());
const avatarRequested = new Set<string>();

function readAvatars(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const parsed = record(JSON.parse(localStorage.getItem('avatars') || '{}'));
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === 'string') result[key] = value;
    return result;
  } catch {
    return {};
  }
}

function storeValidator(validator: string): StoreValidator | undefined {
  try {
    return staking?.validators?.find(item => item.operator_address === validator);
  } catch {
    return undefined;
  }
}

function storeActive(stored: StoreValidator | undefined): boolean | null {
  if (!stored || typeof stored.status !== 'string') return null;
  return stored.jailed !== true && (stored.status === 'BOND_STATUS_BONDED' || stored.status === '3');
}

function nameOf(validator: string): string {
  if (!validator) return '';
  return validatorDetails.value[validator]?.moniker || storeValidator(validator)?.description?.moniker ||
    operatorByValidator.value[validator]?.name || shortAddress(validator);
}

function identityOf(validator: string): string {
  return storeValidator(validator)?.description?.identity || validatorDetails.value[validator]?.identity || '';
}

function logo(identity: string): string {
  const url = identity ? avatars.value[identity] : '';
  if (!url) return '';
  return url.startsWith('http') ? url : 'https://s3.amazonaws.com/keybase_processed_uploads/' + url;
}

function avatarClass(validator: string): string {
  let hash = 0;
  for (const char of validator) hash = (hash * 31 + char.charCodeAt(0)) % 100003;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

function initial(name: string): string {
  return (name.trim()[0] || '?').toUpperCase();
}

function loadAvatar(identity: string) {
  if (!identity || avatars.value[identity] || avatarRequested.has(identity) || typeof staking?.keybase !== 'function') return;
  avatarRequested.add(identity);
  Promise.resolve(staking.keybase(identity)).then(data => {
    const them = record(data).them;
    if (!Array.isArray(them) || !them.length) return;
    const url = record(record(record(them[0]).pictures).primary).url;
    if (typeof url !== 'string' || !url) return;
    avatars.value = { ...avatars.value, [identity]: url.replace('https://s3.amazonaws.com/keybase_processed_uploads/', '') };
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('avatars', JSON.stringify(avatars.value));
    } catch { /* per-viewer convenience only */ }
  }).catch(() => {});
}

function rememberedEndKey(grantee: string): string {
  return 'epix:autocompound-last-end:' + JSON.stringify([chainId.value, owner.value, grantee]);
}

function readRemembered(grantee: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(rememberedEndKey(grantee));
    return value && Number.isFinite(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

// Bumped whenever a remembered end date is written or forgotten, so rows
// (which read localStorage) recompute without waiting for the clock.
const rememberedTick = ref(0);

function rememberEnds(current: CompoundAccount) {
  try {
    if (typeof localStorage === 'undefined') return;
    for (const grant of current.grants) {
      if (grant.messageType === DELEGATE && grant.expiration) localStorage.setItem(rememberedEndKey(grant.grantee), grant.expiration);
    }
    rememberedTick.value += 1;
  } catch { /* per-viewer convenience only */ }
}

// A deliberate turn-off is not a lapsed permission (A27), whether the page
// watched it settle or only found it reconciled on a reload.
function forgetRememberedEnd(grantee: string) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(rememberedEndKey(grantee));
    rememberedTick.value += 1;
  } catch { /* per-viewer convenience only */ }
}

// ---------------------------------------------------------------------------
// Pending transactions (A04 / 10.2)
// ---------------------------------------------------------------------------
interface PendingRow {
  key: string;
  grantee: string;
  msgType: string;
  validator: string;
  kind: 'turn_on' | 'turn_off';
  intent: GrantIntent | 'turn_off';
  hash: string;
  before: { cap: string | null; expiration: string | null } | null;
  polls: number;
  exhausted: boolean;
  stored: boolean;
}
const pendingRows = ref<Record<string, PendingRow>>({});
const recentlyChanged = ref<Record<string, { caption: string; at: number }>>({});
const staleStepTwo = ref<Record<string, boolean>>({});
// Hashes this page has already seen confirmed: the widget clears its own
// storage record only while its dialog polls, so the record can outlive the
// confirmation and must not resurrect a settled row.
const settledHashes = new Set<string>();
// One timer per in-flight pending row, so unmount cancels every poll.
const pollTimers = new Set<ReturnType<typeof setTimeout>>();

function clearPolling() {
  if (typeof clearTimeout === 'function') for (const timer of pollTimers) clearTimeout(timer);
  pollTimers.clear();
}

function pendingKey(grantee: string, msgType: string): string {
  return grantee + '|' + msgType;
}

function pendingFor(grantee: string | undefined, msgType = DELEGATE): PendingRow | null {
  return grantee ? pendingRows.value[pendingKey(grantee, msgType)] || null : null;
}

// Stored records are only evaluated against a loaded account: whether the
// change they describe is already visible on chain decides between a pending
// row (polled like a page-made one) and nothing at all.
function readStoredPending() {
  if (typeof localStorage === 'undefined' || !chainId.value || !owner.value || !account.value) return;
  const grantees = new Set<string>();
  for (const operator of operators.value) grantees.add(operator.grantee);
  for (const grant of account.value.grants) grantees.add(grant.grantee);
  const height = BigInt(account.value.height);
  const next = { ...pendingRows.value };
  const added: PendingRow[] = [];
  for (const grantee of grantees) {
    for (const msgType of [DELEGATE, WITHDRAW]) {
      let entry = null;
      try {
        entry = parsePendingAuthorization(localStorage.getItem(pendingAuthorizationKey(chainId.value, owner.value, grantee, msgType)));
      } catch { /* a missing or malformed entry means not pending */ }
      // A record whose timeout height the chain has passed describes a
      // transaction that can no longer be included: nothing is pending, and a
      // grant that has since ended must not come back as "Confirming…".
      if (entry && BigInt(entry.timeoutHeight) <= height) entry = null;
      const key = pendingKey(grantee, msgType);
      if (!entry) {
        if (next[key]?.stored) delete next[key];
        continue;
      }
      if (next[key] || settledHashes.has(entry.hash)) continue;
      const candidate: PendingRow = {
        key, grantee, msgType, validator: operatorByGrantee(grantee)?.validator || '',
        kind: entry.action === 'autocompound' ? 'turn_on' : 'turn_off',
        intent: entry.action === 'autocompound' ? 'turn_on' : 'turn_off',
        hash: entry.hash, before: null, polls: 0, exhausted: false, stored: true,
      };
      if (pendingSettled(candidate)) {
        // Already on chain: reconciled without a caption, but a reconciled
        // turn-off still drops the remembered end date like a settled one.
        if (candidate.kind === 'turn_off' && msgType === DELEGATE) forgetRememberedEnd(grantee);
        continue;
      }
      next[key] = candidate;
      added.push(candidate);
    }
  }
  pendingRows.value = next;
  for (const item of added) startPolling(item);
}

function operatorByGrantee(grantee: string): CompoundOperator | undefined {
  return operators.value.find(operator => operator.grantee === grantee);
}

// A turn-on only counts once a live grant exists: an ended grant that is still
// listed ("Turn on again") must not settle the row before the new one lands.
function findGrant(entry: PendingRow): CompoundGrant | undefined {
  return account.value?.grants.find(grant => grant.grantee === entry.grantee && grant.messageType === entry.msgType &&
    (entry.msgType !== DELEGATE || !entry.validator || grantCovers(grant, entry.validator)) &&
    (entry.kind !== 'turn_on' || grantLive(grant, Date.now())));
}

function pendingSettled(entry: PendingRow): boolean {
  const grant = findGrant(entry);
  if (entry.kind === 'turn_off') return !grant;
  if (!grant) return false;
  if (!entry.before) return true;
  return grant.cap !== entry.before.cap || grant.expiration !== entry.before.expiration;
}

function captionFor(entry: PendingRow): string {
  switch (entry.intent) {
    case 'turn_off': return entry.msgType === WITHDRAW ? 'Permission removed just now' : 'Turned off just now';
    case 'renew': return 'Renewed just now';
    case 'raise_limit': return 'Limit raised just now';
    case 'change': return 'Changed just now';
    default: return 'Turned on just now';
  }
}

function settlePending(entry: PendingRow) {
  if (entry.hash) settledHashes.add(entry.hash);
  const next = { ...pendingRows.value };
  delete next[entry.key];
  pendingRows.value = next;
  if (entry.kind === 'turn_off' && entry.msgType === DELEGATE) forgetRememberedEnd(entry.grantee);
  const rowKey = entry.validator || 'grant:' + entry.grantee;
  recentlyChanged.value = { ...recentlyChanged.value, [rowKey]: { caption: captionFor(entry), at: Date.now() } };
  if (entry.kind === 'turn_off' && entry.validator && staleRemoved(entry)) {
    staleStepTwo.value = { ...staleStepTwo.value, [entry.validator]: true };
  }
  if (entry.kind === 'turn_on' && entry.validator) {
    staleStepTwo.value = { ...staleStepTwo.value, [entry.validator]: false };
  }
  if (typeof setTimeout === 'function') {
    setTimeout(() => {
      const current = recentlyChanged.value[rowKey];
      if (current && Date.now() - current.at >= 10000) {
        const copy = { ...recentlyChanged.value };
        delete copy[rowKey];
        recentlyChanged.value = copy;
      }
    }, 10500);
  }
  focusElement('ac-primary-' + entry.validator);
}

// Every pending row whose change the reloaded account now shows settles,
// including a row whose polls ran out and was brought back by [Refresh].
function settleVisible() {
  for (const row of Object.values(pendingRows.value)) if (pendingSettled(row)) settlePending(row);
}

function staleRemoved(entry: PendingRow): boolean {
  const operator = operatorByValidator.value[entry.validator];
  return !!operator && operator.grantee !== entry.grantee;
}

// Polls the account every 6 s, up to 5 times, while `entry` is still the
// pending row for its key. `pendingRows` is reactive, so the stored row is a
// proxy of `entry`: identity is compared through toRaw and the row is mutated
// through the proxy so the template follows its poll count.
function startPolling(entry: PendingRow) {
  if (typeof setTimeout !== 'function') return;
  const live = (): PendingRow | null => {
    const row = pendingRows.value[entry.key];
    return row && toRaw(row) === entry ? row : null;
  };
  const poll = async () => {
    if (!live()) return;
    await refreshAccount();
    const row = live();
    if (!row) return;
    if (pendingSettled(row)) { settlePending(row); return; }
    row.polls += 1;
    if (row.polls >= 5) { row.exhausted = true; return; }
    schedule();
  };
  const schedule = () => {
    const timer = setTimeout(() => { pollTimers.delete(timer); void poll(); }, 6000);
    pollTimers.add(timer);
  };
  schedule();
}

interface TxContext { grantee: string; msgType: string; validator: string; intent: GrantIntent | 'turn_off'; before: PendingRow['before'] }

function afterTransaction(result: unknown, context: TxContext) {
  const detail = record(result);
  const hash = typeof detail.hash === 'string' ? detail.hash : '';
  const key = pendingKey(context.grantee, context.msgType);
  const entryFor = (): PendingRow => ({
    key, grantee: context.grantee, msgType: context.msgType, validator: context.validator,
    kind: context.intent === 'turn_off' ? 'turn_off' : 'turn_on', intent: context.intent, hash,
    before: context.before, polls: 0, exhausted: false, stored: false,
  });
  if (detail.phase === 'submitted') {
    const entry = entryFor();
    pendingRows.value = { ...pendingRows.value, [key]: entry };
    startPolling(entry);
    return;
  }
  // Confirmed: the dialog saw the transaction land, so the row settles after
  // one reload whether or not the chain shows the change yet. The reload
  // itself settles every row whose change is visible (refreshAccount), so
  // only a row still pending afterwards, or a confirmation that never had a
  // pending row, is settled here: one caption either way.
  const known = !!pendingRows.value[key];
  void refreshAccount().then(() => {
    const row = pendingRows.value[key];
    if (row) settlePending(row);
    else if (!known && !(hash && settledHashes.has(hash))) settlePending(entryFor());
    readStoredPending();
  });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
interface Row {
  validator: string;
  name: string;
  identity: string;
  stake: string;
  rewards: string | null;
  operator: CompoundOperator | null;
  apr: string;
  active: boolean | null;
  status: DelegationStatus;
  pending: PendingRow | null;
  health: HealthLine | null;
}

const rows = computed<Row[]>(() => {
  const current = account.value;
  if (!current) return [];
  void rememberedTick.value;
  const list = Object.entries(current.delegations)
    .filter(([, stake]) => stake !== '0')
    .map(([validator, stake]) => buildRow(current, validator, stake));
  list.sort((a, b) => (BigInt(b.stake) > BigInt(a.stake) ? 1 : BigInt(b.stake) < BigInt(a.stake) ? -1 : 0));
  return list;
});

function buildRow(current: CompoundAccount, validator: string, stake: string): Row {
  const operator = operatorByValidator.value[validator] || null;
  const details = validatorDetails.value[validator];
  const stored = storeValidator(validator);
  const name = nameOf(validator);
  const rewards = current.unavailable.includes('rewards') ? null : current.rewards[validator] || '0';
  const active = selected.value === validator && validatorActive.value !== null ? validatorActive.value
    : details ? details.active : storeActive(stored);
  const commission = details?.commission || stored?.commission?.commission_rates?.rate || '';
  const rowApr = apr.value ? validatorApr(apr.value, commission) : '';
  const pending = pendingFor(operator?.grantee) ||
    delegateGrants.value.map(grant => grantCovers(grant, validator) ? pendingFor(grant.grantee) : null).find(Boolean) || null;
  const status = delegationStatus({
    row: { validator, name, stake, rewards }, operator, grants: delegateGrants.value, registry: registryState.value,
    validatorActive: active, pending: pending ? pending.kind : null, apr: rowApr, unbondingSeconds: unbondingSeconds.value,
    now: now.value, remembered: operator ? readRemembered(operator.grantee) : null, staleStepTwo: staleStepTwo.value[validator] === true,
    lastRun: operator ? lastRunOf(operator) : null,
  });
  return {
    validator, name, identity: identityOf(validator), stake, rewards, operator, apr: rowApr, active, status, pending,
    health: operator ? healthLine(operator) : null,
  };
}

// Groups are sticky: they are captured when the account or registry data
// arrives, so a row only moves after a confirmed change or a Refresh (A14).
const groupMap = ref<Record<string, StatusGroup>>({});
function snapshotGroups() {
  const map: Record<string, StatusGroup> = {};
  for (const row of rows.value) {
    // A row waiting for confirmation stays where it was until the change is
    // confirmed (A14); each pending poll refreshes the account meanwhile.
    const previous = groupMap.value[row.validator];
    map[row.validator] = row.status.kind === 'pending' && previous ? previous : statusGroup(row.status.kind, !!row.status.grant);
  }
  groupMap.value = map;
}
// The APR arrives separately and can turn a healthy row into "Limit low" or
// "Won't run", and a finished service check can turn it into "Not re-staking",
// so both are snapshot sources. So is a settled or newly pending change: a
// row leaves "Ready to turn on" the moment its turn-on is confirmed.
watch([account, registryState, operators, apr, activityMap, pendingRows], () => snapshotGroups());

function groupOf(row: Row): StatusGroup {
  return groupMap.value[row.validator] || statusGroup(row.status.kind, !!row.status.grant);
}

interface LeftoverRow {
  key: string;
  grant: CompoundGrant;
  validator: string;
  name: string;
  identity: string;
  status: ReturnType<typeof leftoverStatus>;
  pending: PendingRow | null;
}

const leftovers = computed<LeftoverRow[]>(() => {
  if (!account.value) return [];
  const result: LeftoverRow[] = [];
  for (const grant of delegateGrants.value) {
    if (rows.value.some(row => grantCovers(grant, row.validator))) continue;
    const validator = grant.validators[0] || '';
    const name = validator ? nameOf(validator) : 'any validator';
    result.push({
      key: 'leftover:' + grant.grantee + ':' + validator, grant, validator, name, identity: validator ? identityOf(validator) : '',
      status: leftoverStatus(grant, name, now.value), pending: pendingFor(grant.grantee),
    });
  }
  return result;
});

type Filter = 'all' | StatusGroup;
const filter = ref<Filter>('all');
const GROUPS: { key: StatusGroup; title: string; chip: string }[] = [
  { key: 'attention', title: 'Needs attention', chip: 'Needs attention' },
  { key: 'ready', title: 'Ready to turn on', chip: 'Ready' },
  { key: 'on', title: 'On', chip: 'On' },
  { key: 'other', title: "Not offered or couldn't check", chip: 'Not offered' },
];

const pinnedRow = computed(() => focusedQuery.value ? rows.value.find(row => row.validator === focusedQuery.value) || null : null);

// Rows with a live permission to their current service, whatever its health.
const LIVE_KINDS = ['on', 'on_unlisted', 'expiring', 'limit_low', 'limit_reached', 'not_running', 'on_below_minimum'];
const onCount = computed(() => rows.value.filter(row => LIVE_KINDS.includes(row.status.kind)).length);
const readyCount = computed(() => rows.value.filter(row => row.status.kind === 'off').length);

// One set of numbers for the summary sentence, the chips and the group
// headings: rows by their (sticky) group, leftover permissions counted under
// "Needs attention", and `flagged` for rows that are on but need attention.
interface Counts { attention: number; ready: number; on: number; other: number; flagged: number; leftover: number }
const counts = computed<Counts>(() => {
  const result: Counts = { attention: leftovers.value.length, ready: 0, on: 0, other: 0, flagged: 0, leftover: leftovers.value.length };
  for (const row of rows.value) {
    const group = groupOf(row);
    result[group] += 1;
    if (group === 'attention' && LIVE_KINDS.includes(row.status.kind)) result.flagged += 1;
  }
  return result;
});

// The last group only hedges while a row in it really could not be checked.
function groupTitle(key: StatusGroup, groupRows: Row[]): string {
  if (key === 'attention' && !rows.value.length) return 'Permissions on this account';
  if (key === 'other' && groupRows.every(row => row.status.kind === 'not_offered')) return 'Not offered';
  return GROUPS.find(group => group.key === key)?.title || '';
}

interface Section { key: StatusGroup | 'pinned'; title: string; rows: Row[]; total: number; hidden: boolean }
const sections = computed<Section[]>(() => GROUPS
  .map(group => {
    const groupRows = rows.value.filter(row => groupOf(row) === group.key && row.validator !== pinnedRow.value?.validator);
    const total = groupRows.length + (group.key === 'attention' ? leftovers.value.length : 0);
    return { key: group.key, title: groupTitle(group.key, groupRows), rows: groupRows, total, hidden: false };
  })
  .filter(section => section.total > 0 && (filter.value === 'all' || filter.value === section.key)));

// The pinned card keeps the heading order intact under a visually hidden h3.
const groups = computed<Section[]>(() => pinnedRow.value
  ? [{ key: 'pinned', title: 'Validator from the page you came from', rows: [pinnedRow.value], total: 1, hidden: true }, ...sections.value]
  : sections.value);

// "All" carries no number: it mixes delegations with leftover permissions.
const chips = computed(() => [{ key: 'all' as Filter, label: 'All', count: null as number | null },
  ...GROUPS.map(group => ({ key: group.key as Filter, label: group.chip, count: counts.value[group.key] as number | null }))]
  .filter(chip => chip.key === 'all' || (chip.count || 0) > 0));

const leftoverTitleId = computed(() => rows.value.length ? 'ac-group-title-leftover' : 'ac-group-title-attention');
const availableCount = computed(() => rows.value.filter(row => !['not_offered', 'unknown', 'checking'].includes(row.status.kind) &&
  !(row.status.kind === 'validator_inactive' && !row.status.grant)).length);
const noneOffered = computed(() => !!account.value && rows.value.length > 0 && registryState.value === 'ready' && availableCount.value === 0);
const waitingWithoutService = computed(() => {
  const without = rows.value.filter(row => row.status.kind === 'not_offered' && row.rewards !== null && BigInt(row.rewards) > 0n);
  if (!without.length) return null;
  return { count: without.length, total: without.reduce((sum, row) => sum + BigInt(row.rewards || '0'), 0n).toString() };
});
const noLimitCount = computed(() => rows.value.filter(row =>
  (row.status.kind === 'on' || row.status.kind === 'on_unlisted') && row.status.grant && row.status.grant.cap === null).length);

// Derived from `counts`, so the sentence, the chips and the headings agree.
const summary = computed(() => {
  if (!account.value || !rows.value.length) return '';
  // Never a definitive count while the service list is loading or unknown (A13).
  if (registryState.value === 'loading') return '';
  const total = plural(rows.value.length, 'validator');
  const { on, flagged, ready } = counts.value;
  if (noneOffered.value) return 'None of your ' + total + ' offers auto-compound yet.';
  if (!on && !flagged) {
    if (registryState.value === 'unavailable') return "Couldn't check which of your " + total + ' offer auto-compound.';
    return 'Auto-compound is off' + (ready ? '. ' + ready + ' of your ' + total + ' can be turned on.' : ' for all of your ' + total + '.');
  }
  if (!on) return flagged === 1 ? '1 of your ' + total + ' is on but needs attention.' : flagged + ' of your ' + total + ' are on but need attention.';
  const more = flagged === 1 ? ' (1 more is on but needs attention)' : flagged ? ' (' + flagged + ' more are on but need attention)' : '';
  return 'On for ' + on + ' of your ' + total + more + '.';
});

// Default selection: the focused validator, else the first row that needs
// attention, else the first ready, else the first on (A05). Never a registry
// entry the account has not staked with.
function ensureSelection() {
  const list = rows.value;
  if (list.some(row => row.validator === selected.value)) return;
  const live = (group: StatusGroup) => list.find(row => statusGroup(row.status.kind, !!row.status.grant) === group);
  const pick = list.find(row => row.validator === focusedQuery.value) || live('attention') || live('ready') || live('on');
  selected.value = pick ? pick.validator : '';
}
watch(rows, ensureSelection);

// ---------------------------------------------------------------------------
// Focused validator (A05) and the secondary lists
// ---------------------------------------------------------------------------
const focusDismissed = ref(false);
const focused = computed(() => {
  const validator = focusedQuery.value;
  // Without a wallet the connect card already names the validator (A05).
  if (!validator || focusDismissed.value || noWallet.value) return null;
  if (pinnedRow.value) return { kind: 'row' as const, validator, name: pinnedRow.value.name };
  const operator = operatorByValidator.value[validator];
  if (operator) return { kind: 'stake' as const, validator, name: nameOf(validator), operator };
  if (registryState.value === 'ready') return { kind: 'not_listed' as const, validator, name: nameOf(validator) };
  return null;
});

interface Offer {
  operator: CompoundOperator;
  name: string;
  identity: string;
  commission: string;
  power: string;
  inactive: boolean;
  health: HealthLine;
}

const search = ref('');
const offers = computed<Offer[]>(() => {
  const delegated = new Set(rows.value.map(row => row.validator));
  const bondedLoaded = (() => { try { return (staking?.validators?.length || 0) > 0; } catch { return false; } })();
  const list = operators.value.filter(operator => !delegated.has(operator.validator)).map(operator => {
    const stored = storeValidator(operator.validator);
    // The staking store holds the bonded set, so once it is loaded an absent
    // validator is not in the active set. Display only; never a signing check.
    const active = stored ? storeActive(stored) : bondedLoaded ? false : null;
    return {
      operator, name: stored?.description?.moniker || operator.name, identity: identityOf(operator.validator),
      commission: stored?.commission?.commission_rates?.rate || '', power: typeof stored?.tokens === 'string' ? stored.tokens : '',
      inactive: active === false, health: healthLine(operator),
    };
  });
  list.sort((a, b) => Number(a.inactive) - Number(b.inactive) || compareDecimal(a.commission, b.commission) || a.name.localeCompare(b.name));
  return list;
});
const visibleOffers = computed(() => {
  const term = search.value.trim().toLowerCase();
  return term ? offers.value.filter(offer => (offer.name + ' ' + offer.operator.validator).toLowerCase().includes(term)) : offers.value;
});
const largestStake = computed(() => rows.value[0] || null);

function compareDecimal(a: string, b: string): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return Number(a) - Number(b);
}

function percent(rate: string): string {
  const value = Number(rate) * 100;
  return Number.isFinite(value) ? value.toFixed(value % 1 ? 1 : 0) + '%' : '';
}

function powerText(tokens: string): string {
  try {
    return tokens ? formatAmount(tokens, 0) + ' EPIX' : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Service health: the last re-stake of every listed service (A16, extended to
// every card and every offer). Each service account's latest ACTIVITY_LIMIT
// transactions are read through one page-level AbortController with at most
// ACTIVITY_CONCURRENCY requests in flight. Results are kept for FRESH_MS and
// keyed by service account, so filter chips, searches, selection changes and
// clock ticks never re-query. `refreshRegistry` (and so Refresh), an owner,
// endpoint or chain change and unmount abort the batch; the generation
// counter keeps a late response from an earlier batch out of the map.
// ---------------------------------------------------------------------------
const ACTIVITY_LIMIT = 10;
const ACTIVITY_CONCURRENCY = 4;
let activityRequest: AbortController | undefined;
let activityGeneration = 0;
let activityWorkers = 0;
const activityQueue: CompoundOperator[] = [];
// Service accounts queued or in flight in the current generation.
const activityPending = new Set<string>();

type HealthPhase = 'loading' | 'recent' | 'stale' | 'silent' | 'unavailable';
interface HealthLine {
  phase: HealthPhase;
  tone: 'green' | 'amber' | 'gray';
  icon: string;
  text: string;
  short: string;
  activity: CompoundActivity | null;
  own: boolean;
}

function abortActivities() {
  activityRequest?.abort();
  activityRequest = undefined;
  activityGeneration += 1;
  activityWorkers = 0;
  activityQueue.length = 0;
  activityPending.clear();
}

// Every service shown on the page: the rows' own services plus the offers,
// deduplicated by service account.
function activityTargets(): CompoundOperator[] {
  const seen = new Set<string>();
  const result: CompoundOperator[] = [];
  for (const operator of [...rows.value.map(row => row.operator), ...offers.value.map(offer => offer.operator)]) {
    if (operator && !seen.has(operator.grantee)) {
      seen.add(operator.grantee);
      result.push(operator);
    }
  }
  return result;
}

const activityTargetKey = computed(() => activityTargets().map(operator => operator.grantee).sort().join(','));

function activityDue(operator: CompoundOperator, force: boolean): boolean {
  if (activityPending.has(operator.grantee)) return false;
  const entry = activityMap.value[operator.grantee];
  // Never checked, left "loading" by an aborted batch, or failed last time.
  if (!entry || entry.state !== 'done') return true;
  return force || Date.now() - entry.checkedAt >= FRESH_MS;
}

function queueActivities(operators: CompoundOperator[], force = false, first = false) {
  if (!endpoint.value) return;
  const due = operators.filter(operator => activityDue(operator, force));
  if (!due.length) return;
  const next = { ...activityMap.value };
  for (const operator of due) {
    activityPending.add(operator.grantee);
    const previous = next[operator.grantee];
    // A re-check keeps the previous answer underneath "Checking…", so the
    // row's status does not flip while the new one is on its way.
    next[operator.grantee] = previous && previous.state === 'done' ? { ...previous, state: 'loading' }
      : { state: 'loading', activity: null, txCount: null, checkedAt: 0 };
  }
  activityMap.value = next;
  if (first) activityQueue.unshift(...due);
  else activityQueue.push(...due);
  if (!activityRequest) activityRequest = new AbortController();
  for (let spawn = Math.min(due.length, ACTIVITY_CONCURRENCY - activityWorkers); spawn > 0; spawn--) {
    activityWorkers += 1;
    void activityWorker(activityGeneration, activityRequest);
  }
}

async function activityWorker(generation: number, request: AbortController) {
  while (generation === activityGeneration) {
    const operator = activityQueue.shift();
    if (!operator) break;
    await checkOneActivity(operator, generation, request);
  }
  if (generation === activityGeneration) activityWorkers -= 1;
}

async function checkOneActivity(operator: CompoundOperator, generation: number, request: AbortController) {
  let entry: ActivityEntry;
  try {
    const page = await loadActivityPage(endpoint.value, operator, request.signal, owner.value, ACTIVITY_LIMIT);
    entry = { state: 'done', activity: page.activity, txCount: page.txCount, checkedAt: Date.now() };
  } catch {
    entry = { state: 'unavailable', activity: null, txCount: null, checkedAt: Date.now() };
  }
  if (generation !== activityGeneration || request.signal.aborted) return;
  activityPending.delete(operator.grantee);
  activityMap.value = { ...activityMap.value, [operator.grantee]: entry };
}

function scheduleActivities() {
  queueActivities(activityTargets());
}

// The deep check of one service (the selected row, [Check service], [Check
// again]): queued ahead of the batch and written into the same map. `force`
// bypasses the five-minute cache.
function checkActivity(operator: CompoundOperator, force = false) {
  queueActivities([operator], force, true);
}

// Another account, endpoint or chain: nothing cached applies (the preferred
// delegation depends on the owner), so start again.
function resetActivities() {
  abortActivities();
  activityMap.value = {};
  scheduleActivities();
}

watch(activityTargetKey, () => scheduleActivities());

// Verdict for the status model. Only a finished check judges a row; a failed
// check judges nothing, and a re-check in progress keeps its previous answer.
function lastRunOf(operator: CompoundOperator): LastRun | null {
  const entry = activityMap.value[operator.grantee];
  if (!entry || entry.state === 'unavailable' || entry.txCount === null) return null;
  const at = entry.activity ? entry.activity.timestamp : null;
  return { at, state: activityHealth(at, entry.txCount, operator.schedule, now.value).state };
}

const HEALTH_LOADING: HealthLine = {
  phase: 'loading', tone: 'gray', icon: 'mdi:progress-clock', text: "Checking the service's recent re-stakes…", short: 'Checking…',
  activity: null, own: false,
};
const HEALTH_UNAVAILABLE: HealthLine = {
  phase: 'unavailable', tone: 'gray', icon: 'mdi:help-circle-outline', text: "Couldn't check recent re-stakes.", short: "Couldn't check",
  activity: null, own: false,
};

function healthLine(operator: CompoundOperator): HealthLine {
  const entry = activityMap.value[operator.grantee];
  if (!entry || entry.state === 'loading') return HEALTH_LOADING;
  if (entry.state === 'unavailable') return HEALTH_UNAVAILABLE;
  const found = entry.activity;
  const verdict = activityHealth(found ? found.timestamp : null, entry.txCount, operator.schedule, now.value).state;
  if (found && verdict === 'recent') {
    const own = found.delegator === owner.value;
    const when = relativeTime(found.timestamp, now.value);
    return {
      phase: 'recent', tone: 'green', icon: 'mdi:check-circle', text: 'Service last re-staked ' + when + ' ✓' + (own ? ' (for you)' : ''),
      short: 'Last re-stake ' + when, activity: found, own,
    };
  }
  if (found && verdict === 'stale') {
    const when = relativeTime(found.timestamp, now.value);
    return {
      phase: 'stale', tone: 'amber', icon: 'mdi:alert-circle-outline',
      text: 'Service last re-staked ' + when + ', longer than its schedule (' + scheduleText(operator.schedule) + ') allows. It may not be running.',
      short: 'Last re-stake ' + when + ', longer than its schedule allows', activity: found, own: found.delegator === owner.value,
    };
  }
  return {
    phase: 'silent', tone: 'amber', icon: 'mdi:alert-circle-outline',
    text: entry.txCount
      ? "No re-stake in this service's last " + plural(entry.txCount, 'transaction') + '. It may not be running.'
      : "This service hasn't sent any transactions yet. It may not be running.",
    short: 'No recent re-stake', activity: null, own: false,
  };
}

function healthClass(tone: HealthLine['tone']): string {
  switch (tone) {
    case 'green': return 'text-green-800 dark:text-green-300';
    case 'amber': return 'text-amber-800 dark:text-amber-300';
    default: return 'text-gray-600 dark:text-gray-400';
  }
}

// Which rule flagged a "Not re-staking" row (shown in Details).
function notRunningBasis(row: Row): string {
  if (!row.operator) return '';
  return notRunning(row.stake, row.rewards, row.apr, intervalHours(row.operator.schedule), row.operator.minimumReward)
    ? "Based on rewards waiting vs. the service's schedule."
    : "Based on the service's recent transactions.";
}

const offersOpen = ref(false);
const howOpen = ref(false);
const othersOpen = ref(false);
// "Not offered" is folded away whenever something is on or ready; the chip
// opens it, and so does an account with nothing to turn on.
const otherOpen = ref(false);
const expandOther = computed(() => filter.value === 'other' ||
  (!!account.value && registryState.value !== 'loading' && counts.value.on + counts.value.ready + counts.value.flagged === 0));
watch(expandOther, value => { otherOpen.value = value; }, { immediate: true });
function onGroupToggle(key: string, event: Event) {
  if (key === 'other') otherOpen.value = isOpen(event);
}
const detailsOpen = ref<Record<string, boolean>>({});
const copied = ref('');
const announcement = ref('');
let loadedAnnounced = false;

// Both sections expand on the transition into a state that needs them and stay
// collapsed afterwards: watching booleans (not `rows` or `account`, which change
// identity on every clock tick or refresh) keeps a user's collapse.
const expandOffers = computed(() => noWallet.value || noneOffered.value ||
  (!!account.value && registryState.value === 'ready' && !rows.value.length) || focused.value?.kind === 'not_listed');
watch(expandOffers, value => { if (value) offersOpen.value = true; }, { immediate: true });
const expandHow = computed(() => noWallet.value || (!!account.value && !delegateGrants.value.length));
watch(expandHow, value => { if (value) howOpen.value = true; }, { immediate: true });

const unbondingDays = computed(() => {
  if (!unbondingSeconds.value) return null;
  const days = Number(BigInt(unbondingSeconds.value) / 86400n);
  return days > 0 ? days : null;
});

const otherCount = computed(() => withdrawGrants.value.length + otherGrants.value.length);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

async function refreshRegistry() {
  registryRequest?.abort();
  operatorRequest?.abort();
  abortActivities();
  const request = new AbortController();
  registryRequest = request;
  registryLoading.value = true;
  directoryFresh.value = false;
  operatorFresh.value = false;
  registryError.value = '';
  try {
    let snapshot: CompoundOperator[] = [];
    let bundled = false;
    try {
      const saved = record(await fetchJson(new URL('autocompound/operators.json', document.baseURI).href, request.signal));
      if (!Array.isArray(saved.entries) || typeof saved.revision !== 'string' || !/^[0-9a-f]{40}$/.test(saved.revision)) {
        throw new Error('Invalid bundled registry');
      }
      registryRevision.value = saved.revision;
      registryCreatedAt.value = typeof saved.createdAt === 'string' ? saved.createdAt : '';
      snapshot = saved.entries.map(value => {
        const item = record(value);
        if (typeof item.path !== 'string' || !/^[A-Za-z0-9_.-]+\/chains\.json$/.test(item.path)) {
          throw new Error('Invalid bundled registry path');
        }
        return parseOperator({ ...record(item.chain), name: item.name }, REGISTRY_RAW + item.path, item.path);
      });
      bundled = true;
    } catch (error) {
      if (request.signal.aborted) return;
      registryError.value = message(error);
    }
    try {
      const listed = parseDirectory(await fetchJson(DIRECTORY_URL, request.signal));
      if (request.signal.aborted) return;
      operators.value = listed.map(operator => ({
        ...operator, registryPath: snapshot.find(item => item.validator === operator.validator)?.registryPath,
      }));
      directoryFresh.value = true;
      directoryCheckedAt.value = Date.now();
      registryResult.value = 'ready';
      registryNotice.value = '';
    } catch (error) {
      if (request.signal.aborted) return;
      operators.value = snapshot;
      registryResult.value = bundled ? 'ready' : 'unavailable';
      registryNotice.value = bundled ? 'bundled' : 'unavailable';
      if (!bundled) registryError.value = registryError.value || message(error);
    }
    operators.value.sort((a, b) => a.name.localeCompare(b.name));
    ensureSelection();
    readStoredPending();
    scheduleActivities();
    await refreshOperator();
  } finally {
    if (registryRequest === request) registryLoading.value = false;
  }
}

// Keeps the previous account on screen while the same account reloads (A04);
// a different owner, chain or endpoint always starts from nothing.
async function refreshAccount() {
  accountRequest?.abort();
  const request = new AbortController();
  accountRequest = request;
  accountError.value = '';
  accountInvalid.value = false;
  accountLoading.value = false;
  const target = owner.value;
  const scope = [target, endpoint.value, chainId.value].join('|');
  if (accountOwner.value !== scope) {
    account.value = null;
    accountOwner.value = scope;
    // Pending rows, captions and the two-step repair belong to the previous
    // account; none of it may follow a wallet, chain or endpoint switch.
    clearPolling();
    pendingRows.value = {};
    recentlyChanged.value = {};
    staleStepTwo.value = {};
    loadedAnnounced = false;
  }
  accountStale.value = account.value !== null;
  if (!target || !endpoint.value) { account.value = null; accountStale.value = false; return; }
  if (!validAddress(target, 'epix')) {
    account.value = null;
    accountStale.value = false;
    accountInvalid.value = true;
    accountError.value = "The account address in this link isn't a valid Epix address.";
    return;
  }
  accountLoading.value = true;
  try {
    const result = await loadAccount(endpoint.value, chainId.value, target, request.signal);
    if (!request.signal.aborted) {
      account.value = result;
      accountLoadedAt.value = Date.now();
      rememberEnds(result);
      readStoredPending();
      settleVisible();
    }
  } catch (error) {
    if (!request.signal.aborted) accountError.value = message(error);
  } finally {
    if (accountRequest === request) {
      accountLoading.value = false;
      accountStale.value = false;
    }
  }
}

async function refreshOperator() {
  operatorRequest?.abort();
  const request = new AbortController();
  operatorRequest = request;
  operatorFresh.value = false;
  operatorError.value = '';
  validatorActive.value = null;
  const previous = selectedOperator.value;
  if (!previous || !endpoint.value) { operatorPhase.value = 'idle'; return; }
  operatorPhase.value = 'checking';
  let current = previous;
  try {
    if (!directoryFresh.value || Date.now() - directoryCheckedAt.value >= FRESH_MS) {
      if (!previous.registryPath) throw new Error('Refresh the directory to verify this operator.');
      current = parseRegistryEntry(await fetchJson(REGISTRY_RAW + previous.registryPath, request.signal),
        previous.validator, previous.registryPath, previous.name);
      if (request.signal.aborted) return;
      operators.value = operators.value.map(operator => operator.validator === current.validator ? current : operator);
      checkedAt.value = Date.now();
      if (current.grantee !== previous.grantee) {
        // The row re-derives as "Needs attention" from this change (A03); the
        // message is kept for the regression suite and is not rendered.
        operatorError.value = 'The registry operator address changed. Review the new address; old grants remain listed below.';
      }
    } else {
      checkedAt.value = directoryCheckedAt.value;
    }
    if (request.signal.aborted) return;
    operatorFresh.value = true;
    const details = await loadValidator(endpoint.value, current.validator, request.signal);
    if (request.signal.aborted) return;
    validatorActive.value = details.active;
    validatorDetails.value = { ...validatorDetails.value, [current.validator]: details };
  } catch (error) {
    if (!request.signal.aborted) operatorError.value = message(error);
  } finally {
    if (operatorRequest === request) operatorPhase.value = 'done';
  }
  if (request.signal.aborted) return;
  checkActivity(current);
}

async function refreshChainParams() {
  paramsRequest?.abort();
  const request = new AbortController();
  paramsRequest = request;
  if (!endpoint.value) return;
  const [rate, seconds] = await Promise.all([loadApr(endpoint.value, request.signal), loadUnbondingSeconds(endpoint.value, request.signal)]);
  if (request.signal.aborted) return;
  apr.value = rate;
  unbondingSeconds.value = seconds;
}

function refreshAll() {
  cancelAction();
  void refreshRegistry();
  void refreshAccount();
  void refreshChainParams();
}

// ---------------------------------------------------------------------------
// Row actions (A03): one action in flight page-wide
// ---------------------------------------------------------------------------
type ActionPhase = 'checking' | 'blocked' | 'dialog_open';
type ActionBlocker = BlockerCause | 'timeout' | 'error' | 'dialog' | 'unchecked';
interface PendingAction {
  token: number;
  validator: string;
  intent: GrantIntent;
  phase: ActionPhase;
  slow: boolean;
  blocker: ActionBlocker;
  error: string;
}
const pendingAction = ref<PendingAction | null>(null);
let actionToken = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

function clearActionTimers() {
  if (typeof clearTimeout !== 'function') return;
  clearTimeout(slowTimer);
  clearTimeout(timeoutTimer);
}

function cancelAction() {
  clearActionTimers();
  pendingAction.value = null;
}

function waitFor(condition: () => boolean): Promise<void> {
  return new Promise(resolve => {
    if (condition()) { resolve(); return; }
    const stop = watch(condition, ok => { if (ok) { stop(); resolve(); } }, { flush: 'sync' });
  });
}

async function runAction(validator: string, intent: GrantIntent, event?: Event) {
  if (!actionsAllowed.value) return;
  cancelAction();
  const token = ++actionToken;
  pendingAction.value = { token, validator, intent, phase: 'checking', slow: false, blocker: '', error: '' };
  const action = pendingAction.value;
  const current = () => pendingAction.value?.token === token;
  // Only a check that is still in its checking phase may proceed: once the 20 s
  // timeout has blocked the row, a slow refresh that finishes later must not
  // open the dialog behind the user's back (A03: blocked leaves only via
  // [Try again] or an input change).
  const checking = () => current() && pendingAction.value?.phase === 'checking';
  const block = (blocker: ActionBlocker, error = '') => {
    if (!checking()) return;
    clearActionTimers();
    action.phase = 'blocked';
    action.blocker = blocker;
    action.error = error;
    focusElement('ac-blocker-button-' + validator);
  };
  if (typeof setTimeout === 'function') {
    slowTimer = setTimeout(() => { if (checking()) action.slow = true; }, 6000);
    timeoutTimer = setTimeout(() => {
      if (!checking()) return;
      operatorRequest?.abort();
      block('timeout');
    }, 20000);
  }
  try {
    if (selected.value !== validator) {
      selected.value = validator;
      await nextTick();
    }
    if (!checking()) return;
    // A validator query that never answered (validatorActive still null after a
    // fresh listing check) is re-run instead of being reported as "inactive".
    if (!fresh.value || validatorActive.value === null) {
      const operator = selectedOperator.value;
      if (!operator || !operator.registryPath) await refreshRegistry();
      else if (operatorPhase.value !== 'checking') void refreshOperator();
    }
    await waitFor(() => !checking() || selected.value !== validator ||
      (operatorPhase.value !== 'checking' && !registryLoading.value && !accountLoading.value));
    if (!checking()) return;
    if (selected.value !== validator) { block('error', 'Another validator was selected meanwhile.'); return; }
    const cause = blockerCause.value;
    if (cause === 'inactive' && validatorActive.value === null) { block('unchecked'); return; }
    if (cause) { block(cause); return; }
    if (dialogOpen.value) { block('dialog'); return; }
    const opened = openGrant(event || { preventDefault() { /* synthetic */ } } as Event, intent);
    if (!current()) return;
    if (opened) { clearActionTimers(); action.phase = 'dialog_open'; }
    else block(blockerCause.value || 'dialog');
  } catch (error) {
    block('error', message(error));
  }
}

function openGrant(event: Event, intent?: GrantIntent): boolean {
  if (grantBlocker.value || !selectedOperator.value || Date.now() - checkedAt.value >= FRESH_MS || dialogOpen.value) {
    event.preventDefault();
    return false;
  }
  const operator = selectedOperator.value;
  const grant = selectedGrant.value;
  const live = !!grant && grantLive(grant, Date.now());
  const row = rows.value.find(item => item.validator === operator.validator);
  const params: Record<string, unknown> = {
    expected_chain_id: chainId.value, validator_address: operator.validator,
    operator_address: operator.grantee, operator_name: operator.name,
    existing_grant: live,
    intent: intent || (live ? 'change' : 'turn_on'),
    validator_name: nameOf(operator.validator).slice(0, 128),
    schedule: scheduleText(operator.schedule).slice(0, 160),
  };
  const stake = account.value?.delegations[operator.validator];
  if (stake) params.stake_amount = stake;
  if (row?.apr) params.apr = row.apr;
  if (row && row.rewards !== null) params.rewards_amount = row.rewards;
  if (operator.minimumReward !== null) params.minimum_reward = operator.minimumReward;
  if (unbondingSeconds.value) params.unbonding_seconds = unbondingSeconds.value;
  if (grant) {
    if (grant.expiration) params.current_expiration = grant.expiration;
    if (grant.cap !== null) params.current_cap = grant.cap;
    else params.current_cap_unlimited = true;
  }
  const context: TxContext = {
    grantee: operator.grantee, msgType: DELEGATE, validator: operator.validator,
    intent: (params.intent as GrantIntent), before: grant ? { cap: grant.cap, expiration: grant.expiration } : null,
  };
  dialog.openAndShow('autocompound', params, result => afterTransaction(result, context));
  return true;
}

function openRevoke(grant: CompoundGrant, event: Event) {
  if (!canManage.value || !account.value) { event.preventDefault(); return; }
  cancelAction();
  const validator = grant.validators[0] || operatorByGrantee(grant.grantee)?.validator || '';
  dialog.openAndShow('autocompound_revoke', {
    expected_chain_id: chainId.value, operator_address: grant.grantee,
    operator_name: operatorByGrantee(grant.grantee)?.name || '',
    message_type: grant.messageType,
    validator_name: validator ? nameOf(validator).slice(0, 128) : '',
  }, result => afterTransaction(result, {
    grantee: grant.grantee, msgType: grant.messageType, validator: rows.value.find(row => grantCovers(grant, row.validator))?.validator || '',
    intent: 'turn_off', before: { cap: grant.cap, expiration: grant.expiration },
  }));
}

function openDelegate(validator: string) {
  cancelAction();
  dialog.openAndShow('delegate', { validator_address: validator }, result => {
    if (record(result).phase === 'submitted') return;
    void refreshAccount().then(() => { focusDismissed.value = true; focusElement('ac-primary-' + validator); });
  });
}

function openRedelegate(source: string, destination = '') {
  cancelAction();
  dialog.openAndShow('redelegate', { validator_address: source, validator_dst_address: destination || undefined }, result => {
    if (record(result).phase !== 'submitted') void refreshAccount();
  });
}

function act(row: Row, action: StatusAction, event: Event) {
  switch (action.action) {
    case 'turn_on': case 'renew': case 'raise_limit': case 'change':
      if (actionDisabled(row)) return;
      void runAction(row.validator, action.action, event);
      return;
    case 'turn_off': case 'remove_ended':
      if (action.grant) openRevoke(action.grant, event);
      return;
    case 'move_stake':
      openRedelegate(row.validator);
      return;
    case 'check_status':
      if (row.pending?.kind === 'turn_off') {
        if (row.status.grant) openRevoke(row.status.grant, event);
        else refreshAll();
      } else {
        void runAction(row.validator, row.pending && row.pending.intent !== 'turn_off' ? row.pending.intent : 'turn_on', event);
      }
      return;
    case 'check_service':
      checkActivityFor(row.validator);
      return;
    case 'try_again':
      refreshAll();
      return;
    case 'see_offers':
      showOffers();
      return;
  }
}

function isTxAction(action: StatusAction): boolean {
  return !['try_again', 'see_offers', 'check_service'].includes(action.action);
}

function actionDisabled(row: Row): boolean {
  const current = pendingAction.value;
  return !!current && current.phase === 'checking' && current.validator !== row.validator;
}

function isChecking(row: Row): boolean {
  const current = pendingAction.value;
  return !!current && current.phase === 'checking' && current.validator === row.validator;
}

interface BlockerView { text: string; button: { label: string; run: () => void } | null; link: string }

function blockerFor(row: Row): BlockerView | null {
  const current = pendingAction.value;
  if (!current || current.phase !== 'blocked' || current.validator !== row.validator) return null;
  const again = () => void runAction(row.validator, current.intent);
  switch (current.blocker) {
    case 'wallet': return { text: blockerText('wallet', row.validator), button: null, link: '' };
    case 'unavailable': return { text: blockerText('unavailable', row.validator), button: { label: 'Try again', run: refreshAll }, link: '' };
    case 'gone': return { text: blockerText('gone', row.validator), button: { label: 'Reload list', run: refreshAll }, link: '' };
    case 'fresh':
      return /no longer/.test(operatorError.value)
        ? { text: blockerText('fresh', row.validator), button: { label: 'Reload list', run: refreshAll }, link: '' }
        : { text: blockerText('fresh', row.validator), button: { label: 'Try again', run: again }, link: '' };
    case 'inactive': return { text: blockerText('inactive', row.validator), button: null, link: '/staking/' + row.validator };
    case 'delegation': return { text: blockerText('delegation', row.validator), button: { label: 'Stake', run: () => openDelegate(row.validator) }, link: '' };
    case 'withdraw': return { text: blockerText('withdraw', row.validator), button: { label: 'Try again', run: refreshAll }, link: '' };
    case 'unchecked': return { text: "Couldn't check " + row.name + ' right now.', button: { label: 'Try again', run: again }, link: '' };
    case 'timeout': return { text: 'Checking ' + row.name + ' took too long.', button: { label: 'Try again', run: again }, link: '' };
    case 'dialog': return { text: 'Another dialog is open. Close it, then try again.', button: { label: 'Try again', run: again }, link: '' };
    case 'loading': return { text: 'Still loading your account.', button: { label: 'Try again', run: again }, link: '' };
    default: return { text: "Couldn't finish checking: " + (current.error || 'unknown error'), button: { label: 'Try again', run: again }, link: '' };
  }
}

// Blockers clear when the row's inputs change (A03).
watch([account, operators, () => wallet.currentAddress], () => {
  if (pendingAction.value?.phase === 'blocked') pendingAction.value = null;
});

// [Check service]: re-reads that service's transactions (bypassing the cache)
// and makes the row the deeply checked one.
function checkActivityFor(validator: string) {
  cancelAction();
  const operator = operatorByValidator.value[validator];
  if (operator) checkActivity(operator, true);
  if (selected.value !== validator) selected.value = validator;
}

// ---------------------------------------------------------------------------
// DOM helpers (guarded: the component tests run without a window)
// ---------------------------------------------------------------------------
function focusElement(id: string) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  void nextTick(() => {
    try {
      document.getElementById(id)?.focus();
    } catch { /* focus is best effort */ }
  });
}

function jumpTo(id: string, heading: string) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  void nextTick(() => {
    try {
      const target = document.getElementById(id);
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
      document.getElementById(heading)?.focus();
    } catch { /* scrolling is best effort */ }
  });
}

function showOffers() {
  offersOpen.value = true;
  jumpTo('ac-offer', 'ac-offer-title');
}

function showHow() {
  howOpen.value = true;
  jumpTo('ac-how', 'ac-how-title');
}

// The filtered group renders directly below the chips; moving focus to its
// heading would pull a keyboard user out of the radio group on every arrow key.
function selectFilter(key: Filter) {
  filter.value = key;
}

function connectWallet() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  try {
    const toggle = document.getElementById('PingConnectWallet');
    if (toggle && typeof toggle.click === 'function') toggle.click();
  } catch { /* the wallet chooser is outside this page */ }
}

function announce(text: string, duration = 2000) {
  announcement.value = text;
  if (typeof setTimeout === 'function') {
    setTimeout(() => { if (announcement.value === text) announcement.value = ''; }, duration);
  }
}

async function copyAddress(address: string) {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('unsupported');
    await navigator.clipboard.writeText(address);
    copied.value = address;
    announce('Address copied');
    if (typeof setTimeout === 'function') setTimeout(() => { if (copied.value === address) copied.value = ''; }, 1500);
  } catch {
    announce("Couldn't copy the address");
  }
}

function isOpen(event: Event): boolean {
  const target = event.target as { open?: boolean } | null;
  return target?.open === true;
}

function toggleDetails(validator: string, event: Event) {
  detailsOpen.value = { ...detailsOpen.value, [validator]: isOpen(event) };
}

function onVisible() {
  try {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  } catch { /* no visibility API */ }
  if (checkedAt.value && Date.now() - checkedAt.value > FRESH_MS && !registryLoading.value && !accountLoading.value) refreshAll();
}

const listening = typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.addEventListener === 'function';
if (listening) {
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------
// Responsive sizing lives in the page-scoped `ac-*` classes (see <style>): the
// vendored widget injects its own utility stylesheet after the explorer's, so
// plain `sm:` utility overrides for classes it also defines would lose.
// `rounded-[4px]` rather than `rounded`: RouterLinks that reuse these classes
// must escape the global anchor rule in style.css, which skips `[class*="rounded-"]`.
const BTN = 'ac-btn inline-flex items-center justify-center gap-2 rounded-[4px] px-4 py-2 text-sm font-medium ' +
  'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-epix-teal';
const BTN_PRIMARY = BTN + ' ac-btn-primary';
const BTN_QUIET = BTN + ' ac-btn-quiet';
const BTN_DANGER = BTN + ' ac-btn-quiet ac-btn-danger';
const BTN_LINK = 'ac-touch inline-flex items-center gap-1 text-epix-teal underline-offset-2 hover:underline px-1';
// A link inside running text: its tap area comes from padding that negative
// margins cancel, so the line keeps the paragraph's rhythm.
const BTN_INLINE = 'inline-flex items-center gap-1 text-epix-teal underline-offset-2 hover:underline px-1 py-2 -my-2';
// The selected chip is neutral: filled indigo is reserved for actions.
const CHIP = 'ac-touch inline-flex items-center gap-1 rounded-full border px-2.5 text-sm cursor-pointer select-none whitespace-nowrap shrink-0 ' +
  'border-gray-300 dark:border-gray-600 has-[:checked]:bg-gray-500/20 has-[:checked]:border-gray-500 has-[:checked]:font-semibold ' +
  'dark:has-[:checked]:text-white ' +
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-epix-teal';

function toneClass(tone: DelegationStatus['tone']): string {
  switch (tone) {
    case 'green': return 'bg-green-500/15 text-green-800 dark:text-green-300 border-green-500/40';
    case 'amber': return 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40';
    case 'blue': return 'bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/40';
    default: return 'bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-500/40';
  }
}

// Filled indigo means "something to do here": moving stake away from a
// validator that offers nothing is an option, never the page's call to action.
function buttonClass(action: StatusAction, filled: boolean): string {
  if (action.action === 'turn_off' || action.action === 'remove_ended') return filled ? BTN_PRIMARY : BTN_DANGER;
  if (action.action === 'move_stake') return BTN_QUIET;
  if (action.action === 'see_offers') return BTN_LINK;
  return filled ? BTN_PRIMARY : BTN_QUIET;
}

// Only the grant-opening intents wait for another row's check (A03); Turn off,
// Move stake and the read-only actions stay enabled everywhere.
const GRANT_ACTIONS: string[] = ['turn_on', 'renew', 'raise_limit', 'change'];

function permissionLabel(grant: CompoundGrant): string {
  const kind = humanMessageType(grant.messageType || grant.authorizationType);
  return kind === 'Other permission' ? kind : 'Permission to ' + kind.toLowerCase();
}

const WALLET_LABELS: Record<string, string> = {
  Address: 'a view-only address', LedgerUSB: 'Ledger (USB)', LedgerBLE: 'Ledger (Bluetooth)', Metamask: 'MetaMask',
};
const walletLabel = computed(() => WALLET_LABELS[walletName.value] || walletName.value);

function rowCaption(row: Row): string {
  const change = recentlyChanged.value[row.validator];
  if (change && now.value - change.at < 10000) return change.caption;
  return row.validator === pinnedRow.value?.validator ? 'From ' + row.name + "'s page" : '';
}

function highlighted(row: Row): boolean {
  const change = recentlyChanged.value[row.validator];
  return !!change && now.value - change.at < 10000;
}

// Two padded decimals on card lines, four in Details.
function remainingText(grant: CompoundGrant, fixed = false): string {
  if (grant.cap === null) return 'none';
  if (grant.capDenom !== 'aepix' && grant.capDenom !== null) return grant.cap + ' ' + grant.capDenom;
  return (fixed ? formatFixed(grant.cap) : formatAmount(grant.cap, 4)) + ' EPIX';
}

// Details line (A16), from the same map as the card's health line.
function activityText(row: Row): string {
  const operator = row.operator;
  const entry = operator ? activityMap.value[operator.grantee] : undefined;
  if (!operator || !entry) return '';
  if (entry.state === 'loading') return "Checking the service's recent transactions…";
  if (entry.state === 'unavailable') return "Couldn't check recent activity.";
  const found = entry.activity;
  if (found) {
    const when = relativeTime(found.timestamp, now.value);
    if (found.delegator === owner.value) return 'Re-staked your rewards ' + when + ' ✓';
    const yours = operator.minimumReward !== null ? ' Yours happens once your rewards reach ' + formatAmount(operator.minimumReward) + ' EPIX.' : '';
    return activityHealth(found.timestamp, entry.txCount, operator.schedule, now.value).state === 'recent'
      ? 'Service is running: last re-stake ' + when + ', for another account.' + yours
      : 'Last re-stake ' + when + ', for another account, longer than its schedule (' + scheduleText(operator.schedule) + ') allows.';
  }
  if (!entry.txCount) return "This service hasn't sent any transactions yet.";
  return "No re-stake in this service's last " + plural(entry.txCount, 'transaction') + ". That can be normal if nobody's rewards reached the minimum yet.";
}

const updatedText = computed(() => {
  if (accountLoading.value) return 'Updating…';
  if (!accountLoadedAt.value) return '';
  return 'Updated ' + relativeTime(accountLoadedAt.value, now.value);
});

// The live region carries transient messages only. The summary is announced
// once per account (below), when the account and the service list have both
// arrived; afterwards the region returns to silence so "Address copied" or a
// row check is not followed by a re-read of the unchanged summary.
const statusText = computed(() => {
  if (announcement.value) return announcement.value;
  const current = pendingAction.value;
  if (current?.phase === 'checking') return 'Checking ' + nameOf(current.validator) + '…';
  if (accountLoading.value && !account.value) return 'Loading your validators…';
  return '';
});
watch(() => !!account.value && registryState.value !== 'loading', ready => {
  if (!ready || loadedAnnounced) return;
  loadedAnnounced = true;
  announce(summary.value ? 'Loaded. ' + summary.value : 'Loaded.', 5000);
});

const HOW_NOTE = 'What the service may do: stake EPIX that is sitting in this account to the validator, up to the limit, until the end date. ' +
  "Honest services only re-stake rewards, but Epix can't enforce that, which is why the limit matters. " +
  'What it can never do: send your EPIX anywhere, unstake it, move it to another validator, or change where your rewards are paid.';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
watch([owner, endpoint, chainId], () => { cancelAction(); resetActivities(); void refreshAccount(); void refreshOperator(); }, { immediate: true });
watch(endpoint, () => { void refreshChainParams(); }, { immediate: true });
watch(selected, () => { void refreshOperator(); });
// Rows and offers alike: the offers list shows the same keybase avatars.
const avatarIdentities = computed(() => [...rows.value.map(row => row.identity), ...offers.value.map(offer => offer.identity)]);
watch(() => avatarIdentities.value.join(','), () => { for (const identity of avatarIdentities.value) loadAvatar(identity); });
watch([queryAccount, () => wallet.currentAddress], ([query, address]) => {
  if (query && address && query === address && router) {
    try {
      const rest = { ...route.query };
      delete rest.account;
      void router.replace({ path: route.path, query: rest });
    } catch { /* the query is cosmetic */ }
  }
}, { immediate: true });
// Keyed on the validator, not the Row object: `rows` recomputes on every clock
// tick, and re-opening Details or moving focus every 30 s would be hostile.
watch(() => pinnedRow.value?.validator || '', validator => {
  if (validator) {
    detailsOpen.value = { ...detailsOpen.value, [validator]: true };
    focusElement('ac-primary-' + validator);
  }
}, { immediate: true });
void refreshRegistry();
onBeforeUnmount(() => {
  clearInterval(clock);
  clearActionTimers();
  clearPolling();
  if (listening) {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  }
  registryRequest?.abort(); accountRequest?.abort(); operatorRequest?.abort(); paramsRequest?.abort();
  abortActivities();
});
</script>

<template>
  <section class="ac-page space-y-5 pb-8 max-w-full min-w-0">
    <!-- Header: the title row carries Refresh (icon-only below sm); below sm a
         one-line subtitle links to "How it works" instead of explaining. -->
    <header class="space-y-1">
      <RouterLink to="/staking" class="ac-back inline-flex items-center gap-1 text-sm text-epix-teal">
        <Icon icon="mdi:arrow-left" aria-hidden="true" /> Staking
      </RouterLink>
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">Auto-compound</h1>
        <button type="button" :class="BTN_QUIET + ' ac-btn-refresh'" :aria-disabled="registryLoading || accountLoading ? 'true' : undefined"
          aria-label="Refresh: reload your validators and the service list" title="Reload your validators and the service list" @click="refreshAll">
          <span v-if="registryLoading || accountLoading" class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          <Icon v-else icon="mdi:refresh" aria-hidden="true" />
          <span class="ac-refresh-label">Refresh</span>
        </button>
      </div>
      <p class="ac-sm-up text-sm text-gray-600 dark:text-gray-400">
        Automatically re-stake your rewards. Your validator's service does the work and pays for every re-stake; you pay one
        small network fee (about 0.01 EPIX) to turn it on or off. You stay in control.
      </p>
      <p class="ac-sm-down text-sm text-gray-600 dark:text-gray-400">
        Re-stake your rewards automatically. <button type="button" :class="BTN_INLINE" @click="showHow">How it works</button>
      </p>
    </header>

    <!-- Account notices -->
    <p v-if="accountError && (account || accountInvalid)" role="alert" class="modern-card shadow-modern p-4 text-sm text-red-700 dark:text-red-300">
      <span v-if="account">Couldn't refresh your account from the chain. <span class="text-xs text-gray-600 dark:text-gray-400">({{ accountError }})</span></span>
      <span v-else>{{ accountError }}</span>
    </p>
    <div v-if="queryAccount && !canManage" class="modern-card shadow-modern p-4 text-sm space-y-2">
      <p v-if="wallet.currentAddress">
        You're viewing <span class="font-mono tabular-nums">{{ shortAddress(queryAccount) }}</span>. Your wallet is connected as
        <span class="font-mono tabular-nums">{{ shortAddress(wallet.currentAddress) }}</span>, so you can't make changes here.
      </p>
      <p v-else>
        You're viewing <span class="font-mono tabular-nums">{{ shortAddress(queryAccount) }}</span>. Connect your wallet to make changes if this is your account.
      </p>
      <RouterLink v-if="wallet.currentAddress" to="/staking/autocompound" :class="BTN_QUIET">See my validators</RouterLink>
      <button v-else type="button" :class="BTN_PRIMARY" @click="connectWallet">Connect wallet</button>
    </div>
    <div v-if="wallet.currentAddress && !walletSupported" class="modern-card shadow-modern p-4 text-sm">
      Auto-compound can't be changed with {{ walletLabel }} yet. Connect with Keplr or Leap (or the Epix MetaMask Snap).
    </div>
    <div v-if="registryNotice === 'unavailable'" class="modern-card shadow-modern p-4 text-sm ac-banner">
      <span class="flex-1">Couldn't load the list of validator services.</span>
      <button type="button" :class="BTN_QUIET" @click="refreshAll">Try again</button>
    </div>
    <p v-else-if="registryNotice === 'bundled'" class="text-sm text-gray-600 dark:text-gray-400" :title="registryRevision ? 'Revision ' + registryRevision : undefined">
      Using the built-in validator list<span v-if="registryCreatedAt"> from {{ formatDate(registryCreatedAt) }}</span> because the live directory couldn't be read.
      Each validator's details are re-checked against the public validator registry before you turn anything on.
    </p>
    <div v-if="account && account.unavailable.length" class="modern-card shadow-modern p-4 text-sm ac-banner">
      <span class="flex-1">Couldn't load {{ unavailableWords(account.unavailable) }}. You can still turn auto-compound off, but not on.</span>
      <button type="button" :class="BTN_QUIET" @click="refreshAll">Try again</button>
    </div>
    <p v-if="withdrawNotice" class="modern-card shadow-modern p-4 text-sm">{{ withdrawNotice }}</p>

    <!-- State A: nothing to look at yet -->
    <div v-if="noWallet" class="modern-card shadow-modern ac-card space-y-3">
      <p class="text-base text-gray-900 dark:text-white">
        Connect your wallet to see which of your validators can auto-compound<template v-if="focusedQuery"> and to turn on auto-compound for {{ nameOf(focusedQuery) }}</template>.
      </p>
      <button type="button" :class="BTN_PRIMARY" @click="connectWallet">Connect wallet</button>
    </div>

    <!-- Focused validator the account has not staked with (A05 b/c) -->
    <div v-if="focused && focused.kind === 'stake'" class="modern-card shadow-modern ac-card space-y-3 ac-highlight">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ focused.name }}</h2>
      <p class="text-sm">
        {{ focused.name }} runs an auto-compound service ({{ scheduleText(focused.operator.schedule) }}). You haven't staked with
        {{ focused.name }} yet, so there's nothing to re-stake.
      </p>
      <div class="ac-actions">
        <button v-if="actionsAllowed" type="button" :class="BTN_PRIMARY" @click="openDelegate(focused.validator)">Stake with {{ focused.name }}</button>
        <button type="button" :class="BTN_QUIET" @click="focusDismissed = true">Show all my validators</button>
      </div>
    </div>
    <div v-else-if="focused && focused.kind === 'not_listed'" class="modern-card shadow-modern ac-card space-y-3">
      <p class="text-sm">{{ focused.name }} doesn't run an auto-compound service, so auto-compound can't be turned on for it.</p>
      <button type="button" :class="BTN_QUIET" @click="showOffers">See validators that offer auto-compound</button>
    </div>

    <!-- Your validators -->
    <section v-if="!noWallet" aria-labelledby="ac-yours-title" class="space-y-4">
      <div class="space-y-1">
        <h2 id="ac-yours-title" class="text-lg font-semibold text-gray-900 dark:text-white">Your validators</h2>
        <!-- One sentence from the same counts as the chips and the group headings,
             with the account's age folded in. -->
        <p v-if="summary || updatedText" class="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-700 dark:text-gray-300">
          <span v-if="summary">{{ summary }}</span>
          <span v-if="updatedText" class="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap" :title="account ? 'Block ' + account.height : undefined">{{ updatedText }}</span>
        </p>
        <p v-if="waitingWithoutService" class="text-sm text-gray-600 dark:text-gray-400">
          {{ formatFixed(waitingWithoutService.total) }} EPIX of rewards are waiting on {{ plural(waitingWithoutService.count, 'validator') }} without a service.
        </p>
        <p v-if="noLimitCount > 1" class="text-sm text-gray-600 dark:text-gray-400">
          {{ noLimitCount }} permissions have no limit. <button type="button" :class="BTN_INLINE" @click="showHow">What this means</button>
        </p>
      </div>

      <!-- Loading -->
      <div v-if="!account && accountLoading" class="space-y-3" aria-hidden="true">
        <div v-for="index in 3" :key="index" class="modern-card shadow-modern ac-card animate-pulse space-y-3">
          <div class="flex items-center gap-3"><span class="h-10 w-10 rounded-full bg-gray-400/30"></span><span class="h-4 w-40 rounded bg-gray-400/30"></span></div>
          <span class="block h-3 w-56 rounded bg-gray-400/20"></span>
          <span class="block h-10 ac-skeleton-button rounded bg-gray-400/20"></span>
        </div>
      </div>
      <div v-else-if="!account && accountError && !accountInvalid" class="modern-card shadow-modern ac-card space-y-3 text-sm">
        <p>Couldn't load your account from the chain. <span class="text-xs text-gray-600 dark:text-gray-400">({{ accountError }})</span></p>
        <button type="button" :class="BTN_QUIET" @click="refreshAll">Try again</button>
      </div>
      <template v-else-if="account">
        <!-- Filter chips (10.6) -->
        <fieldset v-if="rows.length" class="min-w-0">
          <legend class="sr-only">Show</legend>
          <div class="ac-chips">
            <label v-for="chip in chips" :key="chip.key" :class="CHIP">
              <input type="radio" name="ac-filter" class="sr-only" :value="chip.key" :checked="filter === chip.key" @change="selectFilter(chip.key)" />
              <span>{{ chip.label }}</span><span v-if="chip.count !== null">{{ chip.count }}</span>
            </label>
          </div>
        </fieldset>

        <div v-if="accountStale" class="h-0.5 w-full overflow-hidden rounded bg-gray-400/20" aria-hidden="true">
          <div class="h-full w-1/3 animate-pulse bg-epix-teal"></div>
        </div>

        <p v-if="!rows.length && !leftovers.length" class="modern-card shadow-modern ac-card text-sm space-y-3">
          <span class="block">You haven't staked any EPIX yet. Auto-compound re-stakes rewards per validator, so start by staking with one that offers it.</span>
          <button type="button" :class="BTN_PRIMARY" @click="showOffers">Choose a validator</button>
        </p>

        <!-- Groups (A14). "Not offered" is a collapsible <details>, every other
             group a <div>; the pinned card comes first under a hidden heading. -->
        <component :is="group.key === 'other' ? 'details' : 'div'" v-for="group in groups" :key="group.key" :id="'ac-group-' + group.key"
          class="space-y-3 scroll-mt-24" :open="group.key === 'other' ? otherOpen || undefined : undefined" @toggle="onGroupToggle(group.key, $event)">
          <summary v-if="group.key === 'other'" class="ac-touch flex items-center cursor-pointer select-none">
            <h3 :id="'ac-group-title-' + group.key" tabindex="-1" class="text-base font-semibold text-gray-900 dark:text-white">
              {{ group.title }} <span class="text-gray-600 dark:text-gray-400 font-normal">({{ group.total }})</span>
            </h3>
          </summary>
          <h3 v-else :id="'ac-group-title-' + group.key" tabindex="-1" :class="group.hidden ? 'sr-only' : 'text-base font-semibold text-gray-900 dark:text-white pt-1'">
            {{ group.title }} <span v-if="!group.hidden" class="text-gray-600 dark:text-gray-400 font-normal">({{ group.total }})</span>
          </h3>
          <p v-if="group.key === 'other' && group.rows.some(row => row.status.kind === 'not_offered')" class="text-sm text-gray-600 dark:text-gray-400">
            You can move stake to a validator that offers auto-compound; moving (redelegating) is instant and keeps earning.
          </p>
          <ul :aria-labelledby="'ac-group-title-' + group.key" class="space-y-3" :class="{ 'opacity-70': accountStale }">
            <li v-for="row in group.rows" :key="row.validator" :id="'ac-row-' + row.validator" :aria-busy="isChecking(row) ? 'true' : undefined"
              class="modern-card shadow-modern ac-card min-w-0" :class="{ 'ac-highlight': group.key === 'pinned' || highlighted(row) }">
              <div class="grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-2">
                <div aria-hidden="true">
                  <img v-if="logo(row.identity)" :src="logo(row.identity)" alt="" width="40" height="40" loading="lazy" class="rounded-full h-10 w-10 object-cover" />
                  <span v-else class="flex h-10 w-10 items-center justify-center rounded-full font-semibold" :class="avatarClass(row.validator)">{{ initial(row.name) }}</span>
                </div>
                <div class="min-w-0">
                  <div class="ac-row-head">
                    <div class="min-w-0">
                      <p v-if="group.key === 'pinned'" class="text-xs text-gray-600 dark:text-gray-400">From {{ row.name }}'s page</p>
                      <h4 class="truncate text-base font-semibold" :title="row.name">
                        <RouterLink :to="'/staking/' + row.validator" class="text-gray-900 dark:text-white hover:text-epix-teal">{{ row.name }}</RouterLink>
                      </h4>
                      <p class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                        <span class="font-mono tabular-nums">{{ shortAddress(row.validator) }}</span>
                        <button type="button" class="h-11 w-11 min-h-0 p-0 inline-flex items-center justify-center rounded hover:bg-gray-500/10"
                          :aria-label="'Copy validator address ' + shortAddress(row.validator)" @click="copyAddress(row.validator)">
                          <span v-if="copied === row.validator" class="text-xs">Copied</span>
                          <Icon v-else icon="mdi:content-copy" aria-hidden="true" />
                        </button>
                      </p>
                    </div>
                    <div class="shrink-0 ac-row-badge">
                      <span v-if="row.status.tone === 'skeleton'" class="inline-block h-5 w-24 rounded-full animate-pulse bg-gray-400/30"><span class="sr-only">Status: Checking</span></span>
                      <span v-else class="badge h-auto min-h-5 py-0.5 whitespace-normal gap-1 border text-xs font-medium" :class="toneClass(row.status.tone)">
                        <span class="sr-only">Status: </span><Icon :icon="row.status.icon" aria-hidden="true" class="shrink-0" />{{ row.status.label }}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="ac-row-body space-y-2">
                  <p class="flex flex-wrap gap-x-3 tabular-nums text-sm">
                    <span class="whitespace-nowrap">Staked {{ formatFixed(row.stake) }} EPIX</span>
                    <span v-if="row.rewards !== null" class="whitespace-nowrap">Rewards waiting {{ formatFixed(row.rewards) }} EPIX</span>
                    <span v-else class="whitespace-nowrap text-gray-600 dark:text-gray-400">Rewards unavailable</span>
                  </p>
                  <p v-if="highlighted(row)" class="text-sm text-green-700 dark:text-green-300">{{ rowCaption(row) }}</p>
                  <p v-if="row.status.text" class="text-sm">{{ row.status.text }}</p>
                  <p v-if="row.pending && row.pending.exhausted" class="text-sm">
                    The network hasn't confirmed this yet.
                    <RouterLink v-if="row.pending.hash" :to="'/tx/' + row.pending.hash" class="text-epix-teal">View transaction</RouterLink>
                    <button type="button" :class="BTN_LINK" @click="refreshAll">Refresh</button>
                  </p>
                  <p v-if="row.operator" class="text-sm text-gray-600 dark:text-gray-400">{{ humanThreshold(row.operator.minimumReward, row.stake, row.rewards, row.apr, row.operator.schedule) }}</p>
                  <!-- Last re-stake (ticks with the clock, so never inside a live region) -->
                  <p v-if="row.operator && row.health" class="flex flex-wrap items-center gap-x-1 text-sm" :class="healthClass(row.health.tone)" :data-ac-health="row.health.phase">
                    <Icon :icon="row.health.icon" aria-hidden="true" class="shrink-0" />
                    <span>{{ row.health.text }}</span>
                    <RouterLink v-if="row.health.activity" :to="'/tx/' + row.health.activity.hash" class="text-epix-teal">(view)</RouterLink>
                    <button v-if="row.health.phase === 'unavailable'" type="button" :class="BTN_LINK" @click="checkActivity(row.operator, true)">Check again</button>
                  </p>

                  <!-- Actions -->
                  <div v-if="(row.status.primary || row.status.secondary.length) && row.status.kind !== 'pending' || row.pending" class="ac-actions">
                    <template v-if="row.status.primary && (actionsAllowed || !isTxAction(row.status.primary))">
                      <button :id="'ac-primary-' + row.validator" type="button" :class="buttonClass(row.status.primary, true)" :data-ac-action="row.status.primary.action"
                        :aria-disabled="GRANT_ACTIONS.includes(row.status.primary.action) && actionDisabled(row) ? 'true' : undefined"
                        :title="GRANT_ACTIONS.includes(row.status.primary.action) && actionDisabled(row) ? 'Finishing another check…' : undefined"
                        :aria-describedby="blockerFor(row) ? 'ac-blocker-' + row.validator : undefined" @click="act(row, row.status.primary, $event)">
                        <span v-if="isChecking(row)" class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                        {{ isChecking(row) ? 'Checking…' : row.status.primary.label }}
                      </button>
                    </template>
                    <template v-for="action in row.status.secondary" :key="action.action">
                      <button v-if="actionsAllowed || !isTxAction(action)" type="button" :class="buttonClass(action, false)" :data-ac-action="action.action"
                        :aria-disabled="GRANT_ACTIONS.includes(action.action) && actionDisabled(row) ? 'true' : undefined"
                        :title="GRANT_ACTIONS.includes(action.action) && actionDisabled(row) ? 'Finishing another check…' : undefined"
                        @click="act(row, action, $event)">{{ action.label }}</button>
                    </template>
                  </div>
                  <p v-if="isChecking(row) && pendingAction && pendingAction.slow" class="text-sm text-gray-600 dark:text-gray-400">
                    Still checking… <button type="button" :class="BTN_LINK" @click="cancelAction">Cancel</button>
                  </p>
                  <p v-if="blockerFor(row)" role="alert" :id="'ac-blocker-' + row.validator" class="text-sm text-amber-800 dark:text-amber-300 ac-blocker">
                    <span class="flex-1">{{ blockerFor(row)?.text }}</span>
                    <button v-if="blockerFor(row)?.button" :id="'ac-blocker-button-' + row.validator" type="button" :class="BTN_QUIET"
                      @click="blockerFor(row)?.button?.run()">{{ blockerFor(row)?.button?.label }}</button>
                    <RouterLink v-else-if="blockerFor(row)?.link" :id="'ac-blocker-button-' + row.validator" :to="blockerFor(row)?.link || ''" :class="BTN_QUIET">View validator</RouterLink>
                  </p>

                  <!-- Details -->
                  <details class="text-sm" :open="detailsOpen[row.validator] || undefined" @toggle="toggleDetails(row.validator, $event)">
                    <summary class="ac-touch flex items-center cursor-pointer text-gray-600 dark:text-gray-400 select-none">Details<span class="sr-only"> for {{ row.name }}</span></summary>
                    <div class="space-y-2 pb-1">
                      <p>Validator address: <code class="break-all font-mono text-xs">{{ row.validator }}</code></p>
                      <p class="flex flex-wrap gap-x-3 tabular-nums">
                        <span class="whitespace-nowrap">Staked {{ formatAmount(row.stake, 4) }} EPIX</span>
                        <span v-if="row.rewards !== null" class="whitespace-nowrap">Rewards waiting {{ formatAmount(row.rewards, 4) }} EPIX</span>
                      </p>
                      <template v-if="row.operator">
                        <p>Schedule (set by the validator): {{ scheduleText(row.operator.schedule) }}</p>
                        <p v-if="row.operator.minimumReward === null" class="text-gray-600 dark:text-gray-400">The service's listing states its minimum reward in a form this page can't read.</p>
                        <p v-if="row.status.kind === 'not_running'" class="text-gray-600 dark:text-gray-400">{{ notRunningBasis(row) }}</p>
                        <p class="flex flex-wrap items-center gap-1">
                          <span>Service account (receives the permission):</span>
                          <span class="font-mono tabular-nums">{{ shortAddress(row.operator.grantee) }}</span>
                          <button type="button" class="h-8 w-8 -my-1 min-h-0 p-0 inline-flex items-center justify-center rounded hover:bg-gray-500/10"
                            :aria-label="'Copy service account ' + shortAddress(row.operator.grantee)" @click="copyAddress(row.operator.grantee)">
                            <span v-if="copied === row.operator.grantee" class="text-xs">Copied</span>
                            <Icon v-else icon="mdi:content-copy" aria-hidden="true" />
                          </button>
                        </p>
                        <p v-if="activityText(row)">
                          {{ activityText(row) }}
                          <RouterLink v-if="row.health && row.health.activity && row.health.own" :to="'/tx/' + row.health.activity.hash" class="text-epix-teal">(view)</RouterLink>
                        </p>
                        <p><a :href="row.operator.source" target="_blank" rel="noopener" class="text-epix-teal">View service listing</a></p>
                      </template>
                      <template v-if="row.status.grant">
                        <p>Remaining limit: {{ remainingText(row.status.grant) }}</p>
                        <p v-if="row.status.grant.expiration" class="flex flex-wrap gap-x-3">
                          <span class="whitespace-nowrap">Ends {{ formatDateTime(row.status.grant.expiration) }} (your time)</span>
                          <span class="whitespace-nowrap">{{ formatUtc(row.status.grant.expiration) }}</span>
                        </p>
                        <p v-else>No end date.</p>
                        <p v-if="row.status.grant.cap === null" class="flex flex-wrap items-center gap-2">
                          <span>Limit: none. The service can stake any EPIX in this account to {{ row.name }}<span v-if="row.status.grant.expiration"> until {{ formatDate(row.status.grant.expiration) }}</span>.</span>
                          <button v-if="actionsAllowed && row.operator" type="button" :class="BTN_INLINE" @click="runAction(row.validator, 'change')">Set a limit</button>
                        </p>
                        <!-- Only when the permission names another account than the listed service. -->
                        <p v-if="!row.operator || row.status.grant.grantee !== row.operator.grantee">
                          Permission held by: <span class="font-mono tabular-nums">{{ shortAddress(row.status.grant.grantee) }}</span>
                        </p>
                      </template>
                    </div>
                  </details>
                </div>
              </div>
            </li>
          </ul>

          <!-- Leftover permissions (A14): inside "Needs attention", after its
               delegated rows, so the chip and the heading count the same rows. -->
          <template v-if="group.key === 'attention' && leftovers.length">
            <h4 v-if="rows.length" id="ac-group-title-leftover" class="text-sm font-semibold text-gray-900 dark:text-white pt-1">
              Permissions for validators you no longer stake with
            </h4>
            <ul :aria-labelledby="leftoverTitleId" class="space-y-3" :class="{ 'opacity-70': accountStale }">
              <li v-for="item in leftovers" :key="item.key" class="modern-card shadow-modern ac-card min-w-0">
                <div class="grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-2">
                  <div aria-hidden="true">
                    <img v-if="logo(item.identity)" :src="logo(item.identity)" alt="" width="40" height="40" loading="lazy" class="rounded-full h-10 w-10 object-cover" />
                    <span v-else class="flex h-10 w-10 items-center justify-center rounded-full font-semibold" :class="avatarClass(item.validator || item.grant.grantee)">{{ initial(item.name) }}</span>
                  </div>
                  <div class="min-w-0">
                    <div class="ac-row-head">
                      <div class="min-w-0">
                        <component :is="rows.length ? 'h5' : 'h4'" class="truncate text-base font-semibold" :title="item.name">
                          <RouterLink v-if="item.validator" :to="'/staking/' + item.validator" class="text-gray-900 dark:text-white hover:text-epix-teal">{{ item.name }}</RouterLink>
                          <span v-else class="text-gray-900 dark:text-white">{{ item.name }}</span>
                        </component>
                        <p class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
                          <span class="font-mono tabular-nums">{{ shortAddress(item.validator || item.grant.grantee) }}</span>
                          <button type="button" class="h-11 w-11 min-h-0 p-0 inline-flex items-center justify-center rounded hover:bg-gray-500/10"
                            :aria-label="(item.validator ? 'Copy validator address ' : 'Copy service account ') + shortAddress(item.validator || item.grant.grantee)"
                            @click="copyAddress(item.validator || item.grant.grantee)">
                            <span v-if="copied === (item.validator || item.grant.grantee)" class="text-xs">Copied</span>
                            <Icon v-else icon="mdi:content-copy" aria-hidden="true" />
                          </button>
                        </p>
                      </div>
                      <div class="shrink-0 ac-row-badge">
                        <span class="badge h-auto min-h-5 py-0.5 whitespace-normal gap-1 border text-xs font-medium" :class="toneClass(item.pending ? 'blue' : item.status.tone)">
                          <span class="sr-only">Status: </span><Icon :icon="item.pending ? STATUS_ICONS.pending : item.status.icon" aria-hidden="true" class="shrink-0" />{{ item.pending ? 'Confirming…' : item.status.label }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="ac-row-body space-y-2">
                    <p class="text-sm">{{ item.pending ? 'Waiting for the network to confirm your change.' : item.status.text }}</p>
                    <p class="flex flex-wrap gap-x-3 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                      <span class="whitespace-nowrap">Remaining limit: {{ remainingText(item.grant, true) }}</span>
                      <span v-if="item.grant.expiration" class="whitespace-nowrap">Ends {{ formatDateTime(item.grant.expiration) }}</span>
                    </p>
                    <div v-if="actionsAllowed && !item.pending" class="ac-actions">
                      <button type="button" :class="BTN_PRIMARY" :data-ac-action="item.status.primary.action" @click="openRevoke(item.grant, $event)">{{ item.status.primary.label }}</button>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
          </template>
        </component>
      </template>
    </section>

    <!-- Validators that offer auto-compound (3.4 / A17) -->
    <details id="ac-offer" class="modern-card shadow-modern ac-card scroll-mt-24" :open="offersOpen || undefined" @toggle="offersOpen = isOpen($event)">
      <summary class="ac-touch flex items-center cursor-pointer select-none">
        <h2 id="ac-offer-title" tabindex="-1" class="text-lg font-semibold text-gray-900 dark:text-white">Validators that offer auto-compound</h2>
      </summary>
      <div class="space-y-3 pt-3">
        <p class="text-sm text-gray-600 dark:text-gray-400">You can only auto-compound with a validator you have staked with.</p>
        <p v-if="registryState === 'loading'" class="text-sm text-gray-600 dark:text-gray-400">Loading the service list…</p>
        <p v-else-if="registryState === 'unavailable'" class="text-sm">Couldn't load the list of validator services. <button type="button" :class="BTN_LINK" @click="refreshAll">Try again</button></p>
        <p v-else-if="!operators.length" class="text-sm">No validator has published an auto-compound service yet.</p>
        <template v-else>
          <div v-if="offers.length > 8" class="space-y-1">
            <label for="ac-search" class="block text-sm">Search validators</label>
            <input id="ac-search" v-model="search" type="search" aria-controls="ac-offer-list" class="input input-bordered ac-search ac-touch" />
          </div>
          <p role="status" class="text-sm text-gray-600 dark:text-gray-400">{{ offers.length > 8 ? plural(visibleOffers.length, 'validator') + ' match' : '' }}</p>
          <p v-if="!offers.length" class="text-sm">You already stake with every validator that offers auto-compound.</p>
          <ul id="ac-offer-list" aria-label="Validators that offer auto-compound" class="divide-y divide-gray-200 dark:divide-gray-700">
            <li v-for="offer in visibleOffers" :key="offer.operator.validator" class="py-3 grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-2">
              <div aria-hidden="true">
                <img v-if="logo(offer.identity)" :src="logo(offer.identity)" alt="" width="40" height="40" loading="lazy" class="rounded-full h-10 w-10 object-cover" />
                <span v-else class="flex h-10 w-10 items-center justify-center rounded-full font-semibold" :class="avatarClass(offer.operator.validator)">{{ initial(offer.name) }}</span>
              </div>
              <div class="min-w-0 space-y-1">
                <h3 class="truncate font-semibold" :title="offer.name"><RouterLink :to="'/staking/' + offer.operator.validator" class="text-gray-900 dark:text-white hover:text-epix-teal">{{ offer.name }}</RouterLink></h3>
                <p class="flex flex-wrap gap-x-3 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                  <span v-if="offer.commission" class="whitespace-nowrap">Commission {{ percent(offer.commission) }}</span>
                  <span v-if="powerText(offer.power)" class="whitespace-nowrap">Voting power {{ powerText(offer.power) }}</span>
                  <span class="whitespace-nowrap">{{ humanSchedule(offer.operator.schedule) }}</span>
                </p>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  {{ offer.operator.minimumReward === null ? 'Minimum reward not stated by the service.' : 'Re-stakes once rewards reach ' + formatFixed(offer.operator.minimumReward) + ' EPIX' }}
                </p>
                <p class="flex flex-wrap items-center gap-x-1 text-sm" :class="healthClass(offer.health.tone)" :data-ac-health="offer.health.phase">
                  <Icon :icon="offer.health.icon" aria-hidden="true" class="shrink-0" />
                  <span>{{ offer.health.short }}</span>
                  <button v-if="offer.health.phase === 'unavailable'" type="button" :class="BTN_LINK" @click="checkActivity(offer.operator, true)">Check again</button>
                </p>
                <span v-if="offer.inactive" class="badge h-auto min-h-5 py-0.5 whitespace-normal gap-1 border text-xs font-medium" :class="toneClass('neutral')">
                  <Icon icon="mdi:pause-circle" aria-hidden="true" />Inactive, can't stake
                </span>
                <template v-else-if="actionsAllowed">
                  <div class="ac-actions">
                    <button type="button" :class="BTN_PRIMARY" @click="openDelegate(offer.operator.validator)">Stake</button>
                    <button v-if="largestStake" type="button" :class="BTN_QUIET" @click="openRedelegate(largestStake.validator, offer.operator.validator)">Move stake here</button>
                  </div>
                </template>
                <RouterLink v-else :to="'/staking/' + offer.operator.validator" :class="BTN_QUIET">View validator</RouterLink>
              </div>
            </li>
          </ul>
        </template>
      </div>
    </details>

    <!-- How it works (3.5 / A06) -->
    <details id="ac-how" class="modern-card shadow-modern ac-card scroll-mt-24" :open="howOpen || undefined" @toggle="howOpen = isOpen($event)">
      <summary class="ac-touch flex items-center cursor-pointer select-none">
        <h2 id="ac-how-title" tabindex="-1" class="text-lg font-semibold text-gray-900 dark:text-white">How it works</h2>
      </summary>
      <ol class="list-decimal pl-5 space-y-2 pt-3 text-sm">
        <li>Stake with a validator that runs an auto-compound service.</li>
        <li>Give that service permission to stake from your account. One transaction; you choose a limit and an end date and pay one small network fee (about 0.01 EPIX).</li>
        <li>
          Rewards are re-staked automatically on the service's schedule, so they earn rewards too. Re-staked rewards become part of your stake:
          <template v-if="unbondingDays">like all stake, they take {{ plural(unbondingDays, 'day') }} to unstake.</template>
          <template v-else>like all stake, they can only be unstaked after the network's unbonding period.</template>
          The validator pays those fees. Turn it off any time.
        </li>
      </ol>
      <p class="text-sm text-gray-600 dark:text-gray-400 pt-3">{{ HOW_NOTE }}</p>
    </details>

    <!-- Other permissions (3.6 / A18) -->
    <details v-if="account && otherCount" class="modern-card shadow-modern ac-card" :open="othersOpen || undefined" @toggle="othersOpen = isOpen($event)">
      <summary class="ac-touch flex items-center cursor-pointer select-none">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Other permissions on this account ({{ otherCount }})</h2>
      </summary>
      <ul class="divide-y divide-gray-200 dark:divide-gray-700 pt-2 text-sm">
        <li v-for="grant in withdrawGrants" :key="'w' + grant.grantee" class="py-3 ac-blocker">
          <span class="flex-1">
            Old reward-withdrawal permission for {{ operatorByGrantee(grant.grantee)?.name || shortAddress(grant.grantee) }}. Current services don't need it.
            <span v-if="pendingFor(grant.grantee, WITHDRAW)" class="text-gray-600 dark:text-gray-400">Waiting for the network to confirm your change.</span>
          </span>
          <button v-if="actionsAllowed && !pendingFor(grant.grantee, WITHDRAW)" type="button" :class="BTN_QUIET" @click="openRevoke(grant, $event)">Remove</button>
        </li>
        <li v-for="(grant, index) in otherGrants" :key="'o' + index" class="py-3">
          {{ permissionLabel(grant) }} · held by
          <span class="font-mono tabular-nums">{{ shortAddress(grant.grantee) }}</span>
          <span v-if="grant.expiration"> · ends {{ formatDate(grant.expiration) }}</span>
          <span class="text-gray-600 dark:text-gray-400"> · Not managed here</span>
        </li>
      </ul>
    </details>

    <p id="ac-status" role="status" class="sr-only">{{ statusText }}</p>
  </section>
</template>

<style>
/* Mobile-first sizing and layout. These are page-scoped on purpose: the vendored
   widget appends its own utility stylesheet (with Tailwind's preflight) after the
   explorer's, so a plain `sm:` override of a utility it also defines (flex-col,
   w-full, ...) would lose, and `[type="button"] { background: transparent }`
   would strip single-class button backgrounds. */
.ac-page .btn { min-height: 2.75rem; }
.ac-page .ac-btn-primary { background-color: #6366F1; color: #ffffff; }
.ac-page .ac-btn-primary:hover { background-color: #4F46E5; }
.ac-page .ac-btn-primary:active { background-color: #3730A3; }
.ac-page .ac-btn-primary[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.ac-page .ac-btn-quiet { background-color: transparent; border: 1px solid #d1d5db; color: #1f2937; }
.dark .ac-page .ac-btn-quiet { border-color: #4b5563; color: #e5e7eb; }
.ac-page .ac-btn-quiet:hover { background-color: rgba(107, 114, 128, 0.12); }
.ac-page .ac-btn-quiet[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.ac-page .ac-btn-danger:hover, .ac-page .ac-btn-danger:focus-visible { color: #dc2626; border-color: #ef4444; }
.dark .ac-page .ac-btn-danger:hover, .dark .ac-page .ac-btn-danger:focus-visible { color: #f87171; }
.ac-page .ac-btn { width: 100%; min-height: 2.75rem; }
/* Refresh: icon-only in the title row below sm, never full width. */
.ac-page .ac-btn-refresh { width: 2.75rem; flex-shrink: 0; padding-left: 0; padding-right: 0; }
.ac-page .ac-refresh-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
.ac-page .ac-sm-up { display: none; }
/* The back link keeps a 44px tap area without a 44px line: padding that the
   negative margins cancel (block-level, so no line-box strut adds height). */
.ac-page .ac-back { display: flex; width: fit-content; padding-top: 0.75rem; padding-bottom: 0.75rem; margin-top: -0.75rem; margin-bottom: -0.75rem; }
/* Filter chips: one edge-to-edge scrolling row below sm (the padding keeps
   focus rings inside the scroll box), wrapping above. */
.ac-page .ac-chips { display: flex; gap: 0.375rem; overflow-x: auto; padding: 0.25rem 1rem; margin: -0.25rem -1rem; }
.ac-page .ac-chips > label { padding-left: 0.5rem; padding-right: 0.5rem; }
/* Highlights are outlines: the card's box-shadow (.dark .shadow-modern, a
   two-class selector) would override a Tailwind ring. */
.ac-page .ac-highlight { outline: 2px solid var(--epix-teal, #31BDC6); outline-offset: 2px; }
.ac-page .ac-touch { min-height: 2.75rem; }
.ac-page .ac-card { padding: 1rem; }
.ac-page .ac-row-head { display: flex; flex-direction: column; gap: 0.5rem; }
.ac-page .ac-row-body { grid-column: 1 / span 2; min-width: 0; }
.ac-page .ac-actions { display: flex; flex-direction: column; gap: 0.5rem; padding-top: 0.25rem; }
.ac-page .ac-banner { display: flex; flex-direction: column; gap: 0.75rem; }
.ac-page .ac-blocker { display: flex; flex-direction: column; gap: 0.5rem; }
.ac-page .ac-search { width: 100%; }
.ac-page .ac-skeleton-button { width: 100%; }
@media (min-width: 640px) {
  .ac-page .ac-btn { width: auto; min-height: 2.5rem; }
  .ac-page .ac-btn-refresh { width: auto; padding-left: 1rem; padding-right: 1rem; }
  .ac-page .ac-refresh-label { position: static; width: auto; height: auto; padding: 0; margin: 0; overflow: visible; clip: auto; white-space: normal; }
  .ac-page .ac-sm-up { display: block; }
  .ac-page .ac-sm-down { display: none; }
  .ac-page .ac-chips { flex-wrap: wrap; overflow: visible; gap: 0.5rem; padding: 0.25rem; margin: -0.25rem; }
  .ac-page .ac-chips > label { padding-left: 0.625rem; padding-right: 0.625rem; }
  .ac-page .ac-touch { min-height: 2.5rem; }
  .ac-page .ac-card { padding: 1.25rem; }
  /* The badge follows the name instead of drifting to the far edge of a wide card. */
  .ac-page .ac-row-head { flex-direction: row; align-items: flex-start; justify-content: flex-start; gap: 0.75rem; }
  .ac-page .ac-row-badge { padding-top: 0.125rem; }
  .ac-page .ac-row-body { grid-column: 2 / span 1; }
  .ac-page .ac-actions { flex-direction: row; flex-wrap: wrap; }
  .ac-page .ac-banner, .ac-page .ac-blocker { flex-direction: row; align-items: center; }
  .ac-page .ac-search { width: 20rem; }
  .ac-page .ac-skeleton-button { width: 8rem; }
}
ping-tx-dialog .modal-box .btn { min-height: 2.75rem; }
.ac-page details > summary { list-style: none; }
.ac-page details > summary::-webkit-details-marker { display: none; }
.ac-page details > summary::before {
  content: '';
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  margin-right: 0.5rem;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 0.2s ease;
}
.ac-page details[open] > summary::before { transform: rotate(45deg); }
@media (prefers-reduced-motion: reduce) {
  ping-tx-dialog .modal-box, ping-tx-dialog .btn, .ac-page .btn, .ac-page details > summary::before, .ac-page .animate-pulse {
    transition: none;
    animation: none;
  }
}
</style>
