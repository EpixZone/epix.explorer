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
  minimumReward: string;
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
    schedule, minimumReward: integer(restake.minimum_reward), source, registryPath,
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

export async function loadValidator(endpoint: string, validator: string, signal?: AbortSignal): Promise<boolean> {
  if (!validAddress(validator, 'epixvaloper')) throw new Error('Invalid validator');
  const data = record(await fetchJson(chainUrl(endpoint, '/cosmos/staking/v1beta1/validators/' + validator), signal));
  const value = record(data.validator);
  if (value.operator_address !== validator) throw new Error('Validator identity mismatch');
  return value.jailed === false && (value.status === 'BOND_STATUS_BONDED' || value.status === '3');
}

export function parseActivity(value: unknown, operator: CompoundOperator): CompoundActivity | null {
  const data = record(value);
  if (!Array.isArray(data.txs) || !Array.isArray(data.tx_responses) || data.txs.length !== data.tx_responses.length) {
    throw new Error('Transaction history is unavailable');
  }
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
          return { hash: receipt.txhash, timestamp: receipt.timestamp,
            delegator: delegate.delegator_address, validator: operator.validator };
        }
      }
    }
  }
  return null;
}

export async function loadActivity(endpoint: string, operator: CompoundOperator, signal?: AbortSignal): Promise<CompoundActivity | null> {
  const query = new URLSearchParams({
    query: "message.sender='" + operator.grantee + "'",
    order_by: 'ORDER_BY_DESC', 'pagination.limit': '20',
  });
  return parseActivity(await fetchJson(chainUrl(endpoint, '/cosmos/tx/v1beta1/txs') + '?' + query, signal), operator);
}
