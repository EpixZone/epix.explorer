// Adapted from ECO Stake REStake UI discovery, grant and status flows.
// Upstream revision and MIT notice: THIRD_PARTY_NOTICES/REStake-UI.txt.
import { fromBech32 } from '@cosmjs/encoding';

export const DELEGATE = '/cosmos.staking.v1beta1.MsgDelegate';
export const WITHDRAW = '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward';
export const STAKE_AUTH = '/cosmos.staking.v1beta1.StakeAuthorization';
export const GENERIC_AUTH = '/cosmos.authz.v1beta1.GenericAuthorization';
export const DIRECTORY_URL = 'https://validators.cosmos.directory/chains/epix';
export const REGISTRY_RAW = 'https://raw.githubusercontent.com/eco-stake/validator-registry/master/';

export interface CompoundOperator {
  validator: string;
  grantee: string;
  name: string;
  schedule: string[];
  minimumReward: string | null;
  source: string;
  registryPath?: string;
}

export interface CompoundGrant {
  grantee: string;
  messageType: string;
  authorizationType: string;
  validators: string[];
  deniedValidators: string[];
  cap: string | null;
  capDenom: string | null;
  expiration: string | null;
  bounded: boolean;
}

export interface CompoundAccount {
  chainId: string;
  height: string;
  grants: CompoundGrant[];
  delegations: Record<string, string>;
  rewards: Record<string, string>;
  withdrawAddress: string;
  unavailable: string[];
}

export interface CompoundActivity {
  hash: string;
  timestamp: string;
  delegator: string;
  validator: string;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function validAddress(value: unknown, prefix: 'epix' | 'epixvaloper'): value is string {
  if (typeof value !== 'string' || value !== value.toLowerCase()) return false;
  try {
    const decoded = fromBech32(value);
    return decoded.prefix === prefix && decoded.data.length === 20;
  } catch {
    return false;
  }
}

export function integer(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe integer');
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing integer');
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text) || text.length > 80) throw new Error('Invalid integer');
  return text;
}

// Validate syntax first, then preserve all numeric lexemes as strings. Never
// use the first parse's numbers, including rounded decimal/exponent values.
export function parseExactJson(text: string): unknown {
  JSON.parse(text);
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token, number: string | undefined) => number !== undefined ? JSON.stringify(number) : token));
}

export function formatEpix(base: string): string {
  const digits = integer(base).padStart(19, '0');
  const fraction = digits.slice(-18).replace(/0+$/, '');
  return digits.slice(0, -18) + (fraction ? '.' + fraction : '');
}

function validRunTime(value: string): boolean {
  const interval = /^every (\d+(?:\.\d+)?) (seconds?|minutes?|hours?|days?)$/i.exec(value);
  if (interval) {
    const amount = Number(interval[1]);
    return Number.isFinite(amount) && amount > 0;
  }
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  return !!clock && Number(clock[1]) < 24 && Number(clock[2]) < 60 && Number(clock[3] || 0) < 60;
}

function floorReward(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 110) {
    throw new Error('Invalid reward amount');
  }
  return BigInt(value.split('.')[0]).toString();
}

export function parseOperator(value: unknown, source: string, registryPath?: string): CompoundOperator {
  const item = record(value);
  const restake = record(item.restake);
  const validator = item.operator_address || item.address;
  if (!validAddress(validator, 'epixvaloper') || !validAddress(restake.address, 'epix')) {
    throw new Error('Invalid validator or operator address');
  }
  const schedule = (Array.isArray(restake.run_time) ? restake.run_time : [restake.run_time])
    .flatMap(value => typeof value === 'string' ? value.split(',').map(part => part.trim()) : []);
  if (!schedule.length || schedule.length > 48 ||
      schedule.some(value => !validRunTime(value))) {
    throw new Error('Invalid advertised schedule');
  }
  const name = record(item.description).moniker || item.name || validator;
  return {
    validator, grantee: restake.address,
    name: typeof name === 'string' ? name.slice(0, 160) : validator,
    schedule, minimumReward: exactInteger(restake.minimum_reward), source, registryPath,
  };
}

export function parseDirectory(value: unknown): CompoundOperator[] {
  const data = record(value);
  if (data.name !== 'epix' || !Array.isArray(data.validators)) throw new Error('Invalid Epix registry response');
  const result: CompoundOperator[] = [];
  const seen = new Set<string>();
  for (const entry of data.validators) {
    if (!record(entry).restake) continue;
    const operator = parseOperator(entry, DIRECTORY_URL);
    if (seen.has(operator.validator)) throw new Error('Duplicate registry validator');
    seen.add(operator.validator);
    result.push(operator);
  }
  return result;
}

export function parseRegistryEntry(value: unknown, validator: string, path: string, name: string): CompoundOperator {
  if (!/^[A-Za-z0-9_.-]+\/chains\.json$/.test(path)) throw new Error('Invalid registry path');
  const rows = array(record(value).chains);
  const matches = rows.filter(value => record(value).name === 'epix' && record(value).address === validator);
  if (matches.length !== 1) throw new Error('Validator is no longer uniquely listed in the registry');
  return parseOperator({ ...record(matches[0]), name }, REGISTRY_RAW + path, path);
}

export function parseGrant(value: unknown, owner: string): CompoundGrant {
  const grant = record(value);
  if (grant.granter !== owner || !validAddress(grant.grantee, 'epix')) throw new Error('Invalid grant identity');
  const auth = record(grant.authorization);
  const type = typeof auth['@type'] === 'string' ? auth['@type'] : '';
  const delegate = type === STAKE_AUTH &&
    (auth.authorization_type === 'AUTHORIZATION_TYPE_DELEGATE' || auth.authorization_type === '1');
  const messageType = delegate ? DELEGATE :
    type === GENERIC_AUTH && typeof auth.msg === 'string' ? auth.msg : '';
  const validators = array(record(auth.allow_list).address);
  const deniedValidators = array(record(auth.deny_list).address);
  if ([...validators, ...deniedValidators].some(value => !validAddress(value, 'epixvaloper'))) {
    throw new Error('Invalid grant validator scope');
  }
  const maximum = record(auth.max_tokens);
  const cap = maximum.amount === undefined ? null : integer(maximum.amount);
  const expiration = typeof grant.expiration === 'string' ? grant.expiration : null;
  if (expiration !== null && !Number.isFinite(Date.parse(expiration))) throw new Error('Invalid grant expiration');
  return {
    grantee: grant.grantee, messageType, authorizationType: type,
    validators: validators as string[], deniedValidators: deniedValidators as string[], cap,
    capDenom: typeof maximum.denom === 'string' ? maximum.denom : null, expiration,
    bounded: delegate && validators.length > 0 && deniedValidators.length === 0 &&
      maximum.denom === 'aepix' && cap !== null && expiration !== null,
  };
}

export function grantStatus(grant: CompoundGrant, validator: string, now = Date.now()): string {
  if (grant.expiration && Date.parse(grant.expiration) <= now) return 'Expired';
  if (grant.messageType !== DELEGATE) return 'Other permission';
  if (grant.cap === '0') return 'Allowance exhausted';
  if (grant.validators.length && !grant.validators.includes(validator)) return 'Different validator';
  if (grant.deniedValidators.includes(validator)) return 'Validator excluded';
  if (!grant.bounded) return 'Broader delegation permission';
  return 'Active';
}

export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 12000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('Request failed: HTTP ' + response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body unavailable');
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8 * 1024 * 1024) throw new Error('Response exceeds size limit');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return parseExactJson(text + decoder.decode());
    } finally {
      await reader.cancel().catch(() => {});
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function chainUrl(endpoint: string, path: string): string {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid chain endpoint');
  }
  return endpoint.replace(/\/+$/, '') + path;
}

async function paginated(endpoint: string, path: string, field: string, signal?: AbortSignal): Promise<unknown[]> {
  const result: unknown[] = [];
  const keys = new Set<string>();
  let key = '';
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ 'pagination.limit': '100' });
    if (key) query.set('pagination.key', key);
    const data = record(await fetchJson(chainUrl(endpoint, path) + '?' + query, signal));
    if (!Array.isArray(data[field])) throw new Error('Incomplete ' + field + ' response');
    result.push(...data[field] as unknown[]);
    const next = record(data.pagination).next_key;
    if (!next) return result;
    if (typeof next !== 'string' || keys.has(next)) throw new Error('Invalid pagination');
    keys.add(next);
    key = next;
  }
  throw new Error('Too many pages; status is unavailable');
}

export async function loadAccount(endpoint: string, chainId: string, owner: string, signal?: AbortSignal): Promise<CompoundAccount> {
  if (!/^epix_\d+-\d+$/.test(chainId) || !validAddress(owner, 'epix')) throw new Error('Invalid Epix account or chain');
  const latest = record(await fetchJson(chainUrl(endpoint, '/cosmos/base/tendermint/v1beta1/blocks/latest'), signal));
  const header = record(record(latest.block || latest.sdk_block).header);
  if (header.chain_id !== chainId) throw new Error('Endpoint chain does not match the selected chain');
  const address = encodeURIComponent(owner);
  const [grantsResult, delegationResult, rewardResult, withdrawResult] = await Promise.allSettled([
    paginated(endpoint, '/cosmos/authz/v1beta1/grants/granter/' + address, 'grants', signal),
    paginated(endpoint, '/cosmos/staking/v1beta1/delegations/' + address, 'delegation_responses', signal),
    fetchJson(chainUrl(endpoint, '/cosmos/distribution/v1beta1/delegators/' + address + '/rewards'), signal),
    fetchJson(chainUrl(endpoint, '/cosmos/distribution/v1beta1/delegators/' + address + '/withdraw_address'), signal),
  ]);
  if (grantsResult.status === 'rejected') throw grantsResult.reason;
  const unavailable: string[] = [];
  const grants = grantsResult.value;
  const delegationMap: Record<string, string> = {};
  try {
    if (delegationResult.status === 'rejected') throw delegationResult.reason;
    for (const value of delegationResult.value as unknown[]) {
    const entry = record(value), delegation = record(entry.delegation), balance = record(entry.balance);
    if (delegation.delegator_address !== owner || !validAddress(delegation.validator_address, 'epixvaloper') ||
        balance.denom !== 'aepix') throw new Error('Invalid delegation response');
    delegationMap[delegation.validator_address] = integer(balance.amount);
    }
  } catch {
    for (const key of Object.keys(delegationMap)) delete delegationMap[key];
    unavailable.push('delegations');
  }
  const rewardMap: Record<string, string> = {};
  try {
    if (rewardResult.status === 'rejected') throw rewardResult.reason;
    const rewards = record(rewardResult.value).rewards;
    if (!Array.isArray(rewards)) throw new Error('Incomplete reward response');
    for (const value of rewards) {
    const entry = record(value);
    if (!validAddress(entry.validator_address, 'epixvaloper') || !Array.isArray(entry.reward)) {
      throw new Error('Invalid reward response');
    }
    const coin = entry.reward.find(value => record(value).denom === 'aepix');
    rewardMap[entry.validator_address] = coin ? floorReward(record(coin).amount) : '0';
    }
  } catch {
    for (const key of Object.keys(rewardMap)) delete rewardMap[key];
    unavailable.push('rewards');
  }
  let withdrawAddress = '';
  if (withdrawResult.status === 'fulfilled' && validAddress(record(withdrawResult.value).withdraw_address, 'epix')) {
    withdrawAddress = record(withdrawResult.value).withdraw_address as string;
  } else {
    unavailable.push('reward withdrawal address');
  }
  return {
    chainId, height: integer(header.height), grants: (grants as unknown[]).map(value => parseGrant(value, owner)),
    delegations: delegationMap, rewards: rewardMap, withdrawAddress, unavailable,
  };
}

export interface ValidatorDetails {
  active: boolean;
  moniker: string;
  identity: string;
  commission: string;
  jailed: boolean;
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

// `active` keeps its meaning (bonded and not jailed); the descriptive fields
// tolerate responses that only carry the identity and status.
export async function loadValidator(endpoint: string, validator: string, signal?: AbortSignal): Promise<ValidatorDetails> {
  if (!validAddress(validator, 'epixvaloper')) throw new Error('Invalid validator');
  const data = record(await fetchJson(chainUrl(endpoint, '/cosmos/staking/v1beta1/validators/' + validator), signal));
  const value = record(data.validator);
  if (value.operator_address !== validator) throw new Error('Validator identity mismatch');
  const description = record(value.description);
  const rate = record(record(value.commission).commission_rates).rate;
  return {
    active: value.jailed === false && (value.status === 'BOND_STATUS_BONDED' || value.status === '3'),
    moniker: text(description.moniker, 160),
    identity: text(description.identity, 64),
    commission: decimalToScaled(rate) === null ? '' : rate as string,
    jailed: value.jailed === true,
  };
}

// Scans every delegation of each matching execution and prefers the owner's
// own delegation; otherwise the newest delegation for another account counts.
export function parseActivity(value: unknown, operator: CompoundOperator, owner = ''): CompoundActivity | null {
  const data = record(value);
  if (!Array.isArray(data.txs) || !Array.isArray(data.tx_responses) || data.txs.length !== data.tx_responses.length) {
    throw new Error('Transaction history is unavailable');
  }
  let other: CompoundActivity | null = null;
  for (let index = 0; index < data.txs.length; index++) {
    const receipt = record(data.tx_responses[index]);
    if (String(receipt.code) !== '0') continue;
    const messages = array(record(record(data.txs[index]).body).messages);
    for (const message of messages) {
      const exec = record(message);
      if (exec['@type'] !== '/cosmos.authz.v1beta1.MsgExec' || exec.grantee !== operator.grantee) continue;
      for (const value of array(exec.msgs)) {
        const delegate = record(value);
        if (delegate['@type'] === DELEGATE && delegate.validator_address === operator.validator &&
            validAddress(delegate.delegator_address, 'epix') &&
            typeof receipt.txhash === 'string' && /^[0-9A-Fa-f]{64}$/.test(receipt.txhash) &&
            typeof receipt.timestamp === 'string' && Number.isFinite(Date.parse(receipt.timestamp))) {
          const found = { hash: receipt.txhash, timestamp: receipt.timestamp,
            delegator: delegate.delegator_address, validator: operator.validator };
          if (found.delegator === owner) return found;
          other = other || found;
        }
      }
    }
  }
  return other;
}

// One page of an operator's latest transactions: the preferred delegation (see
// parseActivity) plus how many transactions the page held, so "no transactions
// at all" and "transactions but no re-stake" stay distinguishable.
export interface ActivityPage {
  activity: CompoundActivity | null;
  txCount: number;
}

export function parseActivityPage(value: unknown, operator: CompoundOperator, owner = ''): ActivityPage {
  const activity = parseActivity(value, operator, owner);
  return { activity, txCount: array(record(value).txs).length };
}

export async function loadActivityPage(endpoint: string, operator: CompoundOperator, signal?: AbortSignal, owner = '', limit = 20): Promise<ActivityPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid activity page size');
  const query = new URLSearchParams({
    query: "message.sender='" + operator.grantee + "'",
    order_by: 'ORDER_BY_DESC', 'pagination.limit': String(limit),
  });
  return parseActivityPage(await fetchJson(chainUrl(endpoint, '/cosmos/tx/v1beta1/txs') + '?' + query, signal), operator, owner);
}

export async function loadActivity(endpoint: string, operator: CompoundOperator, signal?: AbortSignal, owner = '', limit = 20): Promise<CompoundActivity | null> {
  return (await loadActivityPage(endpoint, operator, signal, owner, limit)).activity;
}

// ---------------------------------------------------------------------------
// Service health from the last observed re-stake
// ---------------------------------------------------------------------------
export type LastRunState = 'recent' | 'stale' | 'silent' | 'unknown';

export interface LastRun {
  at: string | null;
  state: LastRunState;
}

export interface ActivityHealth {
  state: LastRunState;
  // The longest gap the advertised schedule allows: three intervals plus six
  // hours, at least a day. null when the schedule has no readable interval (a
  // day is then assumed for the verdict).
  maxGapHours: number | null;
}

const HOUR_MS = 3600000;

// `recent`: the last re-stake is within the allowed gap; `stale`: older;
// `silent`: no re-stake in the scanned transactions (none at all counts too);
// `unknown`: the transaction query failed (txCount null), no verdict.
export function activityHealth(lastRunIso: string | null, txCount: number | null, schedule: string[], now: number): ActivityHealth {
  const interval = intervalHours(schedule);
  const maxGapHours = interval === null ? null : Math.max(3 * interval + 6, 24);
  if (txCount === null) return { state: 'unknown', maxGapHours };
  const time = Date.parse(lastRunIso || '');
  if (lastRunIso === null || !Number.isFinite(time)) return { state: 'silent', maxGapHours };
  return { state: now - time <= (maxGapHours ?? 24) * HOUR_MS ? 'recent' : 'stale', maxGapHours };
}

// ---------------------------------------------------------------------------
// Exact numeric helpers. Amounts stay decimal text or BigInt; rates use an
// 18-decimal fixed-point scale so no amount ever passes through Number.
// ---------------------------------------------------------------------------
const SCALE = 10n ** 18n;
const DAY_MS = 86400000;

export function decimalToScaled(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 60) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt((fraction + '0'.repeat(18)).slice(0, 18));
}

export function scaledToDecimal(value: bigint, decimals = 18): string {
  if (value < 0n) return '-' + scaledToDecimal(-value, decimals);
  const digits = value.toString().padStart(19, '0');
  const fraction = digits.slice(-18).slice(0, decimals).replace(/0+$/, '');
  return digits.slice(0, -18) + (fraction ? '.' + fraction : '');
}

// Converts decimal or exponent notation exactly when the value is a
// non-negative integer ("1e+22", "1.5e3", "1.0"); anything that would need
// rounding ("1e-999", "1.0000000000000001") or a sign becomes null.
export function exactInteger(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== 'string' || value.length > 120) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const [, whole, fraction = '', exponent = '0'] = match;
  if (exponent.replace(/^[+-]/, '').length > 4) return null;
  const point = whole.length + Number(exponent);
  let digits = whole + fraction;
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const integerPart = point <= 0 ? '' : digits.slice(0, point);
  const fractionalPart = point <= 0 ? digits : digits.slice(point);
  if (/[1-9]/.test(fractionalPart)) return null;
  const normalized = integerPart.replace(/^0+/, '') || '0';
  return normalized.length > 80 ? null : normalized;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Thousands separators, truncated to `decimals` places, exact string math.
export function formatAmount(base: string | null, decimals = 2): string {
  if (base === null) return '';
  const [whole, fraction = ''] = formatEpix(base).split('.');
  const kept = fraction.slice(0, decimals).replace(/0+$/, '');
  if (whole === '0' && !kept && fraction) return '<' + (decimals > 0 ? '0.' + '0'.repeat(decimals - 1) + '1' : '1');
  return groupThousands(whole) + (kept ? '.' + kept : '');
}

// Like formatAmount, but padded to exactly `decimals` places ("6,119.40",
// "50,000.00") so card lines and lists stay aligned; "<0.01" is kept.
export function formatFixed(base: string | null, decimals = 2): string {
  if (base === null) return '';
  const [whole, fraction = ''] = formatEpix(base).split('.');
  const kept = fraction.slice(0, decimals);
  if (whole === '0' && !/[1-9]/.test(kept) && fraction) return '<' + (decimals > 0 ? '0.' + '0'.repeat(decimals - 1) + '1' : '1');
  return groupThousands(whole) + (decimals > 0 ? '.' + kept.padEnd(decimals, '0') : '');
}

export function plural(count: number, noun: string): string {
  return count + ' ' + noun + (count === 1 ? '' : 's');
}

export function formatDate(value: string | number | null): string {
  const time = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value: string | number | null): string {
  const time = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatUtc(value: string | number | null): string {
  const time = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  return new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// "just now", "4 min ago", "3 h ago", "2 d ago"; older than a week: the date.
export function relativeTime(iso: string | number | null, now = Date.now()): string {
  const time = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' h ago';
  if (seconds <= 7 * 86400) return Math.floor(seconds / 86400) + ' d ago';
  return formatDate(time);
}

// bech32-aware: hrp + "1" + four data characters + "…" + the last six.
export function shortAddress(address: string): string {
  if (typeof address !== 'string') return '';
  const split = address.lastIndexOf('1');
  if (split > 0 && address.length - split > 11) {
    try {
      fromBech32(address);
      return address.slice(0, split + 1) + address.slice(split + 1, split + 5) + '…' + address.slice(-6);
    } catch { /* not bech32 */ }
  }
  return address.length > 17 ? address.slice(0, 10) + '…' + address.slice(-6) : address;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

// ---------------------------------------------------------------------------
// Schedules and thresholds
// ---------------------------------------------------------------------------
const UNIT_HOURS: Record<string, number> = { second: 1 / 3600, minute: 1 / 60, hour: 1, day: 24 };

function parseInterval(entry: string): { amount: number; unit: string } | null {
  const match = /^every (\d+(?:\.\d+)?) (seconds?|minutes?|hours?|days?)$/i.exec(entry.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? { amount, unit: match[2].toLowerCase().replace(/s$/, '') } : null;
}

function parseClock(entry: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(entry.trim());
  if (!match) return null;
  return match[1].padStart(2, '0') + ':' + match[2] + (match[3] && match[3] !== '00' ? ':' + match[3] : '');
}

function intervalText(amount: number, unit: string): string {
  let value = amount;
  if (!Number.isInteger(value)) {
    if (unit === 'day' && Number.isInteger(value * 24)) { value *= 24; unit = 'hour'; }
    else if (unit === 'hour' && Number.isInteger(value * 60)) { value *= 60; unit = 'minute'; }
    else if (unit === 'minute' && Number.isInteger(value * 60)) { value *= 60; unit = 'second'; }
  }
  if (value === 1) return unit;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  return shown + ' ' + unit + 's';
}

// "every 5 minutes" / "every hour" / "daily at 02:00 and 14:00 UTC".
export function scheduleText(schedule: string[]): string {
  const intervals: string[] = [];
  const clocks: string[] = [];
  for (const entry of schedule) {
    const interval = parseInterval(entry);
    if (interval) { intervals.push('every ' + intervalText(interval.amount, interval.unit)); continue; }
    const clock = parseClock(entry);
    if (clock) clocks.push(clock);
  }
  const parts = [...new Set(intervals)];
  if (clocks.length) parts.push('daily at ' + listWords(clocks) + ' UTC');
  return parts.length ? parts.join(' and ') : 'on its own schedule';
}

export function humanSchedule(schedule: string[]): string {
  return 'Runs ' + scheduleText(schedule);
}

// Hours between runs: the first interval entry, or 24 / number of clock times.
export function intervalHours(schedule: string[]): number | null {
  let clocks = 0;
  for (const entry of schedule) {
    const interval = parseInterval(entry);
    if (interval) return interval.amount * UNIT_HOURS[interval.unit];
    if (parseClock(entry)) clocks++;
  }
  return clocks ? 24 / clocks : null;
}

function dailyRewards(stake: string, aprScaled: bigint): bigint {
  return BigInt(stake) * aprScaled / (365n * SCALE);
}

// Days until accrued rewards reach the service minimum (linear: waiting
// rewards do not compound). null without an APR or a stated minimum.
export function daysToThreshold(minimumReward: string | null, rewards: string | null, stake: string, apr: string): number | null {
  const aprScaled = decimalToScaled(apr);
  if (minimumReward === null || aprScaled === null || aprScaled <= 0n) return null;
  const remaining = BigInt(minimumReward) - BigInt(rewards || '0');
  if (remaining <= 0n) return 0;
  const daily = dailyRewards(stake, aprScaled);
  if (daily <= 0n) return Infinity;
  return Number(remaining * 1000n / daily) / 1000;
}

// Days of rewards that `amount` represents at this stake, or null without an APR.
export function daysOfRewards(amount: string | null, stake: string, apr: string): number | null {
  const aprScaled = decimalToScaled(apr);
  if (amount === null || aprScaled === null || aprScaled <= 0n) return null;
  const daily = dailyRewards(stake, aprScaled);
  if (daily <= 0n) return BigInt(amount) > 0n ? Infinity : 0;
  return Number(BigInt(amount) * 1000n / daily) / 1000;
}

// A live grant whose rewards sit well beyond the schedule: the service is
// not doing its job for this account.
export function notRunning(stake: string, rewards: string | null, apr: string, interval: number | null, minimumReward: string | null): boolean {
  if (minimumReward === null || rewards === null) return false;
  const waiting = BigInt(rewards);
  if (waiting < BigInt(minimumReward)) return false;
  const aprScaled = decimalToScaled(apr);
  if (aprScaled === null || aprScaled <= 0n) return waiting > BigInt(stake) / 100n;
  const hours = interval === null ? 24 : interval;
  const window = BigInt(Math.round((3 * hours + 6) * 1000));
  return waiting * 8760n * SCALE * 1000n > BigInt(stake) * aprScaled * window;
}

export function humanDuration(days: number): string {
  if (!Number.isFinite(days) || days >= 36500) return 'more than 100 years';
  if (days < 1 / 24) return 'less than an hour';
  if (days < 1) return plural(Math.max(1, Math.round(days * 24)), 'hour');
  if (days < 60) return plural(Math.max(1, Math.round(days)), 'day');
  if (days < 730) return plural(Math.round(days / 30.4375), 'month');
  return plural(Math.round(days / 365.25), 'year');
}

export function aboutDuration(days: number): string {
  return !Number.isFinite(days) || days >= 36500 ? 'more than 100 years' : 'about ' + humanDuration(days);
}

// Threshold line shown on every card with a service.
export function humanThreshold(minimumReward: string | null, stake: string, rewards: string | null, apr: string, schedule: string[] = []): string {
  if (minimumReward === null) return 'Minimum reward not stated by the service.';
  if (BigInt(minimumReward) < 10n ** 15n) return 'Re-stakes on every run (' + scheduleText(schedule) + ').';
  const days = daysToThreshold(minimumReward, '0', stake, apr);
  let cadence = '';
  if (days !== null) {
    cadence = !Number.isFinite(days) || days >= 36500 ? ', not within 100 years at your stake'
      : days < 1 / 24 ? ', more than once an hour at your stake'
      : ', about every ' + humanDuration(days) + ' at your stake';
  }
  return 'Re-stakes once rewards reach ' + formatAmount(minimumReward) + ' EPIX' + cadence + '.';
}

export function humanMessageType(messageType: string): string {
  if (/MsgVote(Weighted)?$/.test(messageType)) return 'Vote';
  if (/MsgSend$/.test(messageType)) return 'Send';
  return 'Other permission';
}

// ---------------------------------------------------------------------------
// Chain parameters used for estimates (never for signing)
// ---------------------------------------------------------------------------

// Base staking APR as decimal text, '' when any input is unavailable.
export async function loadApr(endpoint: string, signal?: AbortSignal): Promise<string> {
  try {
    const [inflation, distribution, pool, supply] = await Promise.all([
      fetchJson(chainUrl(endpoint, '/epix/mint/v1beta1/inflation'), signal),
      fetchJson(chainUrl(endpoint, '/cosmos/distribution/v1beta1/params'), signal),
      fetchJson(chainUrl(endpoint, '/cosmos/staking/v1beta1/pool'), signal),
      fetchJson(chainUrl(endpoint, '/epix/mint/v1beta1/current_supply'), signal),
    ]);
    const rate = decimalToScaled(record(inflation).inflation);
    const tax = decimalToScaled(record(record(distribution).params).community_tax);
    const bonded = BigInt(integer(record(record(pool).pool).bonded_tokens));
    const total = BigInt(integer(record(supply).current_supply));
    if (rate === null || tax === null || tax > SCALE || bonded <= 0n || total <= 0n) return '';
    const apr = rate * (SCALE - tax) * total / (bonded * SCALE);
    if (apr <= 0n || apr >= 10n * SCALE) return '';
    return scaledToDecimal(apr, 6);
  } catch {
    return '';
  }
}

// APR after a validator's commission; falls back to the base rate.
export function validatorApr(base: string, commission: string): string {
  const apr = decimalToScaled(base);
  if (apr === null || apr <= 0n) return '';
  const rate = decimalToScaled(commission);
  const result = rate === null || rate > SCALE ? apr : apr * (SCALE - rate) / SCALE;
  return result <= 0n ? '' : scaledToDecimal(result, 6);
}

export async function loadUnbondingSeconds(endpoint: string, signal?: AbortSignal): Promise<string> {
  try {
    const params = record(record(await fetchJson(chainUrl(endpoint, '/cosmos/staking/v1beta1/params'), signal)).params);
    const match = /^(\d+)(?:\.\d+)?s$/.exec(typeof params.unbonding_time === 'string' ? params.unbonding_time : '');
    return match ? integer(match[1]) : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Pending transactions (mirrors the widget's storage key; see docs)
// ---------------------------------------------------------------------------
export interface PendingAuthorization {
  hash: string;
  action: 'autocompound' | 'autocompound_revoke';
  createdAt: number;
  timeoutHeight: string;
}

export function pendingAuthorizationKey(chainId: string, owner: string, grantee: string, msgType: string): string {
  return 'epix:pending-authorization:' + JSON.stringify([chainId, owner, grantee, msgType]);
}

// A missing or malformed entry means "not pending".
export function parsePendingAuthorization(raw: unknown): PendingAuthorization | null {
  try {
    if (typeof raw !== 'string' || !raw) return null;
    const value = record(JSON.parse(raw));
    if (typeof value.hash !== 'string' || !/^[A-F0-9]{64}$/.test(value.hash)) return null;
    if (value.action !== 'autocompound' && value.action !== 'autocompound_revoke') return null;
    if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt)) return null;
    if (typeof value.timeoutHeight !== 'string' || !/^[1-9]\d*$/.test(value.timeoutHeight)) return null;
    return { hash: value.hash, action: value.action, createdAt: value.createdAt, timeoutHeight: value.timeoutHeight };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status model (pure)
// ---------------------------------------------------------------------------
export type RegistryState = 'loading' | 'ready' | 'unavailable';
export type GrantIntent = 'turn_on' | 'renew' | 'raise_limit' | 'change';
export type StatusKind = 'checking' | 'pending' | 'stale_permission' | 'expired' | 'validator_inactive' |
  'limit_reached' | 'not_running' | 'on_below_minimum' | 'expiring' | 'limit_low' | 'on_unlisted' | 'on' |
  'off' | 'unknown' | 'not_offered';
export type StatusTone = 'green' | 'amber' | 'blue' | 'gray' | 'neutral' | 'skeleton';
export type StatusGroup = 'attention' | 'ready' | 'on' | 'other';
export type ActionKind = GrantIntent | 'turn_off' | 'move_stake' | 'check_status' | 'check_service' |
  'try_again' | 'see_offers' | 'remove_ended';

export interface StatusAction {
  label: string;
  action: ActionKind;
  grant?: CompoundGrant;
}

export interface DelegationStatus {
  kind: StatusKind;
  label: string;
  tone: StatusTone;
  icon: string;
  text: string;
  primary: StatusAction | null;
  secondary: StatusAction[];
  grant: CompoundGrant | null;
}

export interface StatusInput {
  row: { validator: string; name?: string; stake: string; rewards: string | null };
  operator: CompoundOperator | null;
  grants: CompoundGrant[];
  registry: RegistryState;
  validatorActive: boolean | null;
  pending: 'turn_on' | 'turn_off' | null;
  apr: string;
  unbondingSeconds: string;
  now: number;
  remembered?: string | null;
  staleStepTwo?: boolean;
  // Verdict of the service's recent transactions (activityHealth); only a
  // `stale` or `silent` verdict changes anything, and only for a row that
  // would otherwise be plain "On".
  lastRun?: LastRun | null;
}

export const STATUS_ICONS: Record<StatusKind | 'leftover', string> = {
  on: 'mdi:check-circle', on_unlisted: 'mdi:check-circle', off: 'mdi:pause-circle-outline',
  expiring: 'mdi:clock-alert-outline', expired: 'mdi:clock-remove-outline', limit_reached: 'mdi:gauge-full',
  limit_low: 'mdi:gauge', stale_permission: 'mdi:alert-circle', validator_inactive: 'mdi:pause-circle',
  not_offered: 'mdi:minus-circle-outline', not_running: 'mdi:alert-circle-outline', on_below_minimum: 'mdi:timer-sand',
  pending: 'mdi:progress-clock', unknown: 'mdi:help-circle-outline', checking: 'mdi:progress-clock',
  leftover: 'mdi:link-variant-off',
};

export function grantCovers(grant: CompoundGrant, validator: string): boolean {
  if (grant.messageType !== DELEGATE) return false;
  return grant.validators.length ? grant.validators.includes(validator) : !grant.deniedValidators.includes(validator);
}

export function grantLive(grant: CompoundGrant, now: number): boolean {
  return grant.expiration === null || Date.parse(grant.expiration) > now;
}

export function statusGroup(kind: StatusKind, hasGrant: boolean): StatusGroup {
  switch (kind) {
    case 'stale_permission': case 'expired': case 'limit_reached': case 'not_running':
    case 'on_below_minimum': case 'expiring': case 'limit_low':
      return 'attention';
    case 'validator_inactive':
      return hasGrant ? 'attention' : 'other';
    case 'off': case 'pending':
      return 'ready';
    case 'on': case 'on_unlisted':
      return 'on';
    default:
      return 'other';
  }
}

function endsText(grant: CompoundGrant): string {
  return grant.expiration ? 'until ' + formatDate(grant.expiration) : 'with no end date';
}

const TURN_OFF: StatusAction = { label: 'Turn off', action: 'turn_off' };
const MOVE_STAKE: StatusAction = { label: 'Move stake', action: 'move_stake' };

function status(kind: StatusKind, label: string, tone: StatusTone, text: string,
  primary: StatusAction | null, secondary: StatusAction[], grant: CompoundGrant | null): DelegationStatus {
  return { kind, label, tone, icon: STATUS_ICONS[kind], text, primary, secondary, grant };
}

export function delegationStatus(input: StatusInput): DelegationStatus {
  const { row, operator, registry, now, apr } = input;
  const name = row.name || shortAddress(row.validator);
  const rewards = row.rewards;
  const matching = input.grants.filter(grant => grantCovers(grant, row.validator));
  const live = matching.filter(grant => grantLive(grant, now));
  const ended = matching.filter(grant => !grantLive(grant, now));
  const current = operator ? live.find(grant => grant.grantee === operator.grantee) || null : live[0] || null;
  const others = operator ? live.filter(grant => grant.grantee !== operator.grantee) : [];
  const turnOff = (grant: CompoundGrant): StatusAction => ({ ...TURN_OFF, grant });
  const minimum = operator ? operator.minimumReward : null;

  if (registry === 'loading' && !matching.length) {
    return status('checking', 'Checking', 'skeleton', 'Checking whether ' + name + ' offers auto-compound…', null, [], null);
  }
  if (input.pending) {
    return status('pending', 'Confirming…', 'blue', 'Waiting for the network to confirm your change.',
      { label: 'Check status', action: 'check_status' }, [], current);
  }
  if (operator && others.length) {
    return status('stale_permission', 'Needs attention', 'amber',
      name + ' moved its service to a new account (' + shortAddress(operator.grantee) + '). Your permission still points at the old one, ' +
      'which this page no longer trusts. Step 1 of 2: turn off the old permission. Step 2 of 2: turn on again for the new account. ' +
      'Two transactions, two small fees.',
      { label: 'Turn off old permission', action: 'turn_off', grant: others[0] }, [], others[0]);
  }
  if (operator && !current && input.staleStepTwo) {
    return status('stale_permission', 'Needs attention', 'amber',
      'Step 2 of 2 · Turn on with ' + name + "'s new service account", { label: 'Turn on', action: 'turn_on' }, [], null);
  }
  if (!live.length && ended.length) {
    const grant = ended[0];
    return status('expired', 'Ended', 'amber', 'Your permission ended on ' + formatDate(grant.expiration) + '.',
      operator ? { label: 'Turn on again', action: 'turn_on' } : null,
      [{ label: 'Remove ended permission', action: 'remove_ended', grant }], grant);
  }
  if (input.validatorActive === false) {
    return status('validator_inactive', 'Inactive', 'neutral',
      name + ' is jailed or not in the active set, so it earns no rewards and there is nothing to re-stake.' +
      (current ? ' Your permission stays in place.' : ''),
      null, [...(current ? [turnOff(current)] : []), MOVE_STAKE], current);
  }
  if (current) {
    const grant = current;
    const waiting = BigInt(rewards || '0');
    const cap = grant.cap === null ? null : BigInt(grant.cap);
    const floor = minimum === null ? waiting : BigInt(minimum) > waiting ? BigInt(minimum) : waiting;
    if (cap !== null && (cap === 0n || cap < floor)) {
      // No reward figure when rewards could not be loaded: "0 EPIX waiting" would be a claim.
      const waitingText = rewards === null ? '' : ', ' + formatAmount(rewards) + ' EPIX of rewards waiting';
      return status('limit_reached', 'Limit reached', 'amber',
        "The service can't fit your next re-stake under the limit (" + formatAmount(grant.cap) + ' EPIX left' + waitingText +
        '). Raise it to continue.',
        operator ? { label: 'Raise limit', action: 'raise_limit' } : null, [turnOff(grant)], grant);
    }
    if (operator && notRunning(row.stake, rewards, apr, intervalHours(operator.schedule), minimum)) {
      const days = daysOfRewards(rewards, row.stake, apr);
      const label = days === null ? '' : humanDuration(days);
      const worth = days === null ? '' : ' (about ' + label + (/^1 /.test(label) ? "'s worth)" : "' worth)");
      return status('not_running', 'Not re-staking', 'amber',
        'Permission is on, but ' + formatAmount(rewards || '0') + ' EPIX of rewards' + worth +
        " are waiting. The service hasn't re-staked for you recently.",
        { label: 'Check recent activity', action: 'check_service' }, [turnOff(grant)], grant);
    }
    const untilEnd = grant.expiration ? (Date.parse(grant.expiration) - now) / DAY_MS : null;
    const toThreshold = operator ? daysToThreshold(minimum, rewards, row.stake, apr) : null;
    if (operator && minimum !== null && toThreshold !== null && untilEnd !== null && toThreshold > untilEnd) {
      return status('on_below_minimum', "Won't run", 'amber',
        'This service only re-stakes once your rewards reach ' + formatAmount(minimum) + ' EPIX. At your stake that takes ' +
        aboutDuration(toThreshold) + ', longer than this permission lasts, so it would never run.',
        MOVE_STAKE, [turnOff(grant)], grant);
    }
    if (untilEnd !== null && untilEnd <= 30) {
      const daysLeft = Math.ceil(untilEnd);
      const when = daysLeft < 1 ? 'in less than a day' : 'in ' + plural(daysLeft, 'day');
      return status('expiring', 'Ends soon', 'amber',
        'Ends ' + when + ' (' + formatDate(grant.expiration) + '). Renew to keep re-staking.',
        operator ? { label: 'Renew', action: 'renew' } : null, [turnOff(grant)], grant);
    }
    const capDays = cap === null ? null : daysOfRewards(grant.cap, row.stake, apr);
    if (capDays !== null && capDays < 30) {
      return status('limit_low', 'Limit low', 'amber',
        'About ' + plural(Math.max(1, Math.round(capDays)), 'day') + ' of rewards left before the limit. Raise it to avoid a pause.',
        operator ? { label: 'Raise limit', action: 'raise_limit' } : null, [turnOff(grant)], grant);
    }
    if (!operator || registry === 'unavailable') {
      const text = registry === 'unavailable'
        ? "Couldn't check the service list. This permission is active " + endsText(grant) + '.'
        : registry === 'loading'
          ? 'Checking the service list. This permission is active ' + endsText(grant) + '.'
          : 'Granted to a service that is no longer in the public list (' + shortAddress(grant.grantee) + '). It can still re-stake ' +
            endsText(grant) + '.';
      return status('on_unlisted', 'On', 'green', text, null, [turnOff(grant)], grant);
    }
    // The service's own transactions say it is not running: a last re-stake
    // older than its schedule allows, or none at all. The reward-based rule
    // above already took precedence when both apply; loading, failed or recent
    // checks leave the row "On".
    const lastRun = input.lastRun;
    if (lastRun && (lastRun.state === 'stale' || lastRun.state === 'silent')) {
      const when = lastRun.state === 'stale' ? relativeTime(lastRun.at, now) : '';
      return status('not_running', 'Not re-staking', 'amber',
        when
          ? 'Permission is on, but this service last re-staked for anyone ' + when + ', longer than its schedule (' +
            scheduleText(operator.schedule) + ') allows. It may not be running.'
          : "Permission is on, but this service hasn't re-staked for anyone in its recent transactions. It may not be running.",
        { label: 'Check recent activity', action: 'check_service' }, [turnOff(grant)], grant);
    }
    const prefix = grant.expiration ? 'Until ' + formatDate(grant.expiration) : 'No end date';
    return status('on', 'On', 'green',
      prefix + ' · ' + (grant.cap === null ? 'no limit' : 'can still re-stake up to ' + formatAmount(grant.cap) + ' EPIX'),
      null, [{ label: 'Change limit or end date', action: 'change' }, turnOff(grant)], grant);
  }
  if (operator) {
    const remembered = input.remembered && Number.isFinite(Date.parse(input.remembered)) && Date.parse(input.remembered) <= now
      ? input.remembered : null;
    const parts: string[] = [];
    if (remembered) parts.push('Your permission ended on ' + formatDate(remembered) + '.');
    if (rewards !== null && minimum !== null && BigInt(rewards) >= BigInt(minimum) && BigInt(rewards) > 0n) {
      parts.push(formatAmount(rewards) + ' EPIX of rewards are waiting; turn on to let the service re-stake them.');
    }
    const toThreshold = daysToThreshold(minimum, rewards, row.stake, apr);
    if (minimum !== null && toThreshold !== null && toThreshold > 365) {
      parts.push('Heads-up: this service only re-stakes once rewards reach ' + formatAmount(minimum) + ' EPIX, ' +
        aboutDuration(toThreshold) + ' at your stake.');
    }
    return status('off', 'Off', 'gray', parts.join(' '),
      { label: remembered ? 'Turn on again' : 'Turn on', action: 'turn_on' }, [], null);
  }
  if (registry === 'unavailable') {
    return status('unknown', "Couldn't check", 'gray',
      "Couldn't load the list of validator services, so we can't tell whether " + name + ' offers auto-compound.',
      { label: 'Try again', action: 'try_again' }, [], null);
  }
  // One line: the page explains moving stake once, above the "Not offered" group.
  return status('not_offered', 'Not offered', 'neutral', "Doesn't run an auto-compound service.",
    MOVE_STAKE, [{ label: 'See validators that offer auto-compound', action: 'see_offers' }], null);
}

export interface LeftoverStatus {
  label: string;
  tone: StatusTone;
  icon: string;
  text: string;
  primary: StatusAction;
}

// Live delegate permissions for validators the account no longer stakes with.
export function leftoverStatus(grant: CompoundGrant, name: string, now: number): LeftoverStatus {
  const ended = !grantLive(grant, now);
  return {
    label: ended ? 'Ended' : 'Leftover', tone: 'amber', icon: ended ? STATUS_ICONS.expired : STATUS_ICONS.leftover,
    text: ended
      ? 'This permission for ' + name + ' ended on ' + formatDate(grant.expiration) + '. Remove it to keep this account tidy.'
      : 'You no longer stake with ' + name + ', but its service can still stake EPIX from this account to it ' + endsText(grant) +
        '. Turn it off unless you plan to stake here again.',
    primary: { label: ended ? 'Remove ended permission' : 'Turn off', action: ended ? 'remove_ended' : 'turn_off', grant },
  };
}

// ---------------------------------------------------------------------------
// Shared service health for the validator list: which validators offer an
// auto-compound service and whether that service is observed running. The
// staking list renders one icon per validator from this; the auto-compound
// page keeps its own richer, per-account view.
// ---------------------------------------------------------------------------

export type ServiceIndicatorKind = 'running' | 'not_running' | 'offered';

export interface ServiceIndicator {
  kind: ServiceIndicatorKind;
  title: string;
}

export interface ServiceCheck {
  state: 'loading' | LastRunState;
  lastRun: string | null;
  txCount: number | null;
}

// Maps an operator plus its activity check to the list icon. 'offered' covers
// a check that is still running or could not be made: the validator does
// advertise a service, but nothing is known about whether it runs.
export function serviceIndicator(operator: CompoundOperator, check: ServiceCheck | undefined, now = Date.now()): ServiceIndicator {
  const schedule = scheduleText(operator.schedule);
  if (!check || check.state === 'loading') {
    return { kind: 'offered', title: `Offers auto-compound (${schedule}). Checking recent activity…` };
  }
  if (check.state === 'unknown') {
    return { kind: 'offered', title: `Offers auto-compound (${schedule}). Couldn't check recent activity.` };
  }
  if (check.state === 'recent') {
    return { kind: 'running', title: `Auto-compound running: last re-stake ${relativeTime(check.lastRun, now)} (${schedule}).` };
  }
  if (check.state === 'stale') {
    return {
      kind: 'not_running',
      title: `Auto-compound offered, but the service last re-staked ${relativeTime(check.lastRun, now)}, longer than its schedule (${schedule}) allows. It may not be running.`,
    };
  }
  return {
    kind: 'not_running',
    title: check.txCount === 0
      ? 'Auto-compound offered, but the service has not sent any transactions yet. It may not be running.'
      : `Auto-compound offered, but no re-stake in the service's last ${check.txCount} transactions. It may not be running.`,
  };
}

export interface OperatorList {
  operators: CompoundOperator[];
  source: 'directory' | 'bundled';
}

// Loads the operator list the same way the auto-compound page does: the live
// directory when reachable, otherwise the bundled snapshot. Throws only when
// neither source can be read.
export async function loadOperatorList(baseURI: string, signal?: AbortSignal): Promise<OperatorList> {
  let snapshot: CompoundOperator[] = [];
  let bundled = false;
  let bundledError: unknown;
  try {
    const saved = record(await fetchJson(new URL('autocompound/operators.json', baseURI).href, signal));
    if (!Array.isArray(saved.entries) || typeof saved.revision !== 'string' || !/^[0-9a-f]{40}$/.test(saved.revision)) {
      throw new Error('Invalid bundled registry');
    }
    snapshot = saved.entries.map(value => {
      const item = record(value);
      if (typeof item.path !== 'string' || !/^[A-Za-z0-9_.-]+\/chains\.json$/.test(item.path)) {
        throw new Error('Invalid bundled registry path');
      }
      return parseOperator({ ...record(item.chain), name: item.name }, REGISTRY_RAW + item.path, item.path);
    });
    bundled = true;
  } catch (error) {
    bundledError = error;
  }
  if (signal?.aborted) throw new Error('Request aborted');
  try {
    const listed = parseDirectory(await fetchJson(DIRECTORY_URL, signal));
    return {
      operators: listed.map(operator => ({
        ...operator, registryPath: snapshot.find(item => item.validator === operator.validator)?.registryPath,
      })),
      source: 'directory',
    };
  } catch (error) {
    if (bundled) return { operators: snapshot, source: 'bundled' };
    throw error || bundledError || new Error('Registry unavailable');
  }
}
