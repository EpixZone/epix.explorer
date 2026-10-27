const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { toBech32 } = require('@cosmjs/encoding');

const filename = resolve(__dirname, '../src/libs/autocompound.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function load(fetch = async () => { throw new Error('Unexpected request'); }, overrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require, fetch,
    URL, URLSearchParams, AbortController, TextDecoder, setTimeout, clearTimeout,
    ...overrides,
  }, { filename });
  return module.exports;
}

const plain = value => JSON.parse(JSON.stringify(value));
// A chip as rendered: "All" carries no number (10.6 as amended by review).
const chipText = chip => chip.count === null ? chip.label : chip.label + ' ' + chip.count;
const address = (prefix, byte) => toBech32(prefix, new Uint8Array(20).fill(byte));
const OWNER = address('epix', 1);
const BOT = address('epix', 2);
const OTHER_BOT = address('epix', 3);
const VALIDATOR = address('epixvaloper', 4);
const OTHER_VALIDATOR = address('epixvaloper', 5);
const ENDPOINT = 'https://chain.example';
const CHAIN = 'epix_1916-1';
const DELEGATE = '/cosmos.staking.v1beta1.MsgDelegate';
const WITHDRAW = '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward';
const STAKE_AUTH = '/cosmos.staking.v1beta1.StakeAuthorization';
const GENERIC_AUTH = '/cosmos.authz.v1beta1.GenericAuthorization';
const FUTURE = '2099-01-01T00:00:00Z';
const NOW = Date.parse('2040-01-01T00:00:00Z');

function operator(overrides = {}) {
  return {
    address: VALIDATOR,
    name: 'Example validator',
    restake: { address: BOT, run_time: 'every 1 hour', minimum_reward: '1000000000000000000' },
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    granter: OWNER, grantee: BOT, expiration: FUTURE,
    authorization: {
      '@type': STAKE_AUTH, authorization_type: 'AUTHORIZATION_TYPE_DELEGATE',
      allow_list: { address: [VALIDATOR] }, max_tokens: { denom: 'aepix', amount: '1000000000000000000' },
    },
    ...overrides,
  };
}

function delegation(validator = VALIDATOR, amount = '9007199254740993') {
  return { delegation: { delegator_address: OWNER, validator_address: validator },
    balance: { denom: 'aepix', amount } };
}

function fixtureFetch(overrides = {}, calls = []) {
  const rows = {
    latest: { block: { header: { chain_id: CHAIN, height: '9007199254740993' } } },
    grants: { grants: [grant()], pagination: { next_key: null } },
    delegations: { delegation_responses: [delegation()], pagination: { next_key: null } },
    rewards: { rewards: [{ validator_address: VALIDATOR,
      reward: [{ denom: 'aepix', amount: '9007199254740993.999999999999999999' }] }] },
    withdraw: { withdraw_address: OWNER },
    ...overrides,
  };
  return async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    const key = path.endsWith('/blocks/latest') ? 'latest'
      : path.includes('/grants/granter/') ? 'grants'
      : path.includes('/delegations/') ? 'delegations'
      : path.endsWith('/rewards') ? 'rewards'
      : path.endsWith('/withdraw_address') ? 'withdraw' : null;
    assert.ok(key, 'Unexpected fixture path: ' + path);
    let value = rows[key];
    if (typeof value === 'function') value = await value(url, options);
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value), { status: 200 });
  };
}

test('exact JSON retains large integers and never rewrites numeric-looking strings or escapes', () => {
  const api = load();
  const input = '{"integer":18446744073709551615,"negative":-9007199254740993,' +
    '"decimal":1.0000000000000001,"exponent":1e-999,"bool":false,' +
    '"text":"18446744073709551615 \\"1e999\\" \\\\ 123","empty":null}';
  const result = api.parseExactJson(input);
  assert.equal(result.integer, '18446744073709551615');
  assert.equal(result.negative, '-9007199254740993');
  assert.equal(result.decimal, '1.0000000000000001');
  assert.equal(result.exponent, '1e-999');
  assert.equal(result.text, JSON.parse(input).text);
  assert.equal(result.bool, false);
  assert.equal(result.empty, null);
});

test('exact JSON rejects malformed syntax before quoting numeric tokens', () => {
  const api = load();
  for (const text of ['{1:2}', '{"n":01}', '{"n":+1}', '{"n":NaN}', '{"n":1,}', '[1,]']) {
    assert.throws(() => api.parseExactJson(text), undefined, text);
  }
});

test('decimal and exponent registry thresholds cannot become rounded safe integers', () => {
  const api = load();
  // Spec 10.3: exact conversion when the value is an integer, otherwise null
  // (the operator is kept, its threshold is "not stated"); never a rounded number.
  const expected = {
    '1.0000000000000001': null, '9007199254740991.1': null, '1e-999': null, '-0': null,
    '1e3': '1000', '1.0': '1', '1e+22': '1' + '0'.repeat(22), '1.5e3': '1500', '0e5': '0',
  };
  for (const [token, value] of Object.entries(expected)) {
    const raw = JSON.stringify(operator()).replace('"1000000000000000000"', token);
    const parsed = api.parseOperator(api.parseExactJson(raw), 'fixture');
    assert.equal(parsed.minimumReward, value, token);
    assert.equal(parsed.validator, VALIDATOR, token);
  }
  const exact = JSON.stringify(operator()).replace('"1000000000000000000"', '10000000000000000000001');
  assert.equal(api.parseOperator(api.parseExactJson(exact), 'fixture').minimumReward, '10000000000000000000001');
  assert.equal(api.exactInteger('1e+22'), '1' + '0'.repeat(22));
  assert.equal(api.exactInteger('9007199254740993'), '9007199254740993');
  assert.equal(api.exactInteger(1e3), '1000');
  for (const value of ['1e-999', '1.0000000000000001', '9007199254740991.1', '-1', '+1', '01', 'NaN', '', null, 1.5, 2 ** 53, '1e99999', '1e100']) {
    assert.equal(api.exactInteger(value), null, String(value));
  }
  // Other registry fields stay strict.
  assert.throws(() => api.parseOperator(operator({ restake: { ...operator().restake, address: 'nope' } }), 'fixture'), /address/);
});

test('integer rejects unsafe numbers and ambiguous strings while retaining exact large amounts', () => {
  const api = load();
  assert.equal(api.integer(Number.MAX_SAFE_INTEGER), '9007199254740991');
  assert.equal(api.integer('18446744073709551615'), '18446744073709551615');
  for (const value of [9007199254740992, 1.1, NaN, Infinity, -1, '', '01', '+1', ' 1', '1e3', '1.0', null, '1'.repeat(81)]) {
    assert.throws(() => api.integer(value), undefined, String(value));
  }
});

test('18-decimal display retains single base units and large amounts exactly', () => {
  const api = load();
  assert.equal(api.formatEpix('0'), '0');
  assert.equal(api.formatEpix('1'), '0.000000000000000001');
  assert.equal(api.formatEpix('1000000000000000000'), '1');
  assert.equal(api.formatEpix('18446744073709551615'), '18.446744073709551615');
});

test('addresses require the exact lowercase prefix, valid checksum and 20-byte identity', () => {
  const api = load();
  assert.equal(api.validAddress(OWNER, 'epix'), true);
  for (const value of [OWNER.toUpperCase(), VALIDATOR, OWNER.slice(0, -1) + (OWNER.endsWith('q') ? 'p' : 'q'), toBech32('epix', new Uint8Array(21))]) {
    assert.equal(api.validAddress(value, 'epix'), false);
  }
});

test('directory rejects a wrong chain, duplicate validator or invalid bot identity', () => {
  const api = load();
  const valid = api.parseDirectory({ name: 'epix', validators: [operator()] });
  assert.equal(valid[0].validator, VALIDATOR);
  assert.equal(valid[0].grantee, BOT);
  assert.equal(valid[0].source, api.DIRECTORY_URL);
  assert.throws(() => api.parseDirectory({ name: 'other', validators: [operator()] }), /registry/);
  assert.throws(() => api.parseDirectory({ name: 'epix', validators: [operator(), operator()] }), /Duplicate/);
  assert.throws(() => api.parseDirectory({ name: 'epix', validators: [operator({ restake: { ...operator().restake, address: VALIDATOR } })] }), /address/);
});

test('advertised intervals must be positive and finite', () => {
  const api = load();
  for (const run_time of ['every 0 hours', 'every 0.0 seconds', 'every -1 hours', 'every ' + '9'.repeat(400) + ' hours']) {
    assert.throws(() => api.parseOperator(operator({ restake: { ...operator().restake, run_time } }), 'fixture'), /schedule/i, run_time);
  }
  assert.deepEqual(plain(api.parseOperator(operator({ restake: { ...operator().restake,
    run_time: 'every 0.5 hours' } }), 'fixture').schedule), ['every 0.5 hours']);
});

test('advertised fixed UTC times reject out-of-range clock components', () => {
  const api = load();
  for (const run_time of ['24:00', '99:99', '1:60', '23:59:60']) {
    assert.throws(() => api.parseOperator(operator({ restake: { ...operator().restake, run_time } }), 'fixture'), /schedule/i, run_time);
  }
  assert.deepEqual(plain(api.parseOperator(operator({ restake: { ...operator().restake,
    run_time: ['0:00', '23:59:59'] } }), 'fixture').schedule), ['0:00', '23:59:59']);
});

test('direct registry refresh requires an exact unique chain/validator and exposes a changed bot', () => {
  const api = load();
  const entry = { ...operator(), name: 'epix' };
  const read = chains => api.parseRegistryEntry({ chains }, VALIDATOR, 'Example/chains.json', 'Example');
  assert.equal(read([entry]).grantee, BOT);
  assert.equal(read([{ ...entry, restake: { ...entry.restake, address: OTHER_BOT } }]).grantee, OTHER_BOT);
  assert.throws(() => read([{ ...entry, name: 'other' }]), /no longer/);
  assert.throws(() => read([{ ...entry, address: OTHER_VALIDATOR }]), /no longer/);
  assert.throws(() => read([entry, entry]), /uniquely/);
  assert.throws(() => api.parseRegistryEntry({ chains: [entry] }, VALIDATOR, 'https://evil.example/chains.json', 'Example'), /path/);
});

test('bounded delegation classification retains exact cap, validator scope and expiry', () => {
  const api = load();
  const parsed = api.parseGrant(grant(), OWNER);
  assert.equal(parsed.bounded, true);
  assert.equal(parsed.cap, '1000000000000000000');
  assert.deepEqual(plain(parsed.validators), [VALIDATOR]);
  assert.equal(parsed.expiration, FUTURE);
  assert.equal(api.grantStatus(parsed, VALIDATOR, NOW), 'Active');
});

test('expired and exhausted grants are never shown as active', () => {
  const api = load();
  const expired = api.parseGrant(grant({ expiration: '2039-01-01T00:00:00Z' }), OWNER);
  assert.equal(api.grantStatus(expired, VALIDATOR, NOW), 'Expired');
  const raw = grant(); raw.authorization.max_tokens.amount = '0';
  assert.equal(api.grantStatus(api.parseGrant(raw, OWNER), VALIDATOR, NOW), 'Allowance exhausted');
});

test('allow and deny lists are honored when classifying the selected validator', () => {
  const api = load();
  assert.equal(api.grantStatus(api.parseGrant(grant(), OWNER), OTHER_VALIDATOR, NOW), 'Different validator');
  const raw = grant(); delete raw.authorization.allow_list;
  raw.authorization.deny_list = { address: [VALIDATOR] };
  const parsed = api.parseGrant(raw, OWNER);
  assert.equal(parsed.bounded, false);
  assert.equal(api.grantStatus(parsed, VALIDATOR, NOW), 'Validator excluded');
  assert.equal(api.grantStatus(parsed, OTHER_VALIDATOR, NOW), 'Broader delegation permission');
});

test('unlimited, unexpiring and wrong-denomination delegation grants remain visibly broader', () => {
  const api = load();
  const cases = [grant({ expiration: null }), grant(), grant()];
  delete cases[1].authorization.max_tokens;
  cases[2].authorization.max_tokens.denom = 'other';
  for (const raw of cases) {
    const parsed = api.parseGrant(raw, OWNER);
    assert.equal(parsed.bounded, false);
    assert.equal(api.grantStatus(parsed, VALIDATOR, NOW), 'Broader delegation permission');
  }
  assert.equal(api.parseGrant(cases[2], OWNER).capDenom, 'other');
});

test('legacy generic delegate and withdrawal grants retain their exact revocation message types', () => {
  const api = load();
  const legacy = msg => api.parseGrant(grant({ authorization: { '@type': GENERIC_AUTH, msg } }), OWNER);
  assert.equal(api.grantStatus(legacy(DELEGATE), VALIDATOR, NOW), 'Broader delegation permission');
  assert.equal(legacy(DELEGATE).messageType, DELEGATE);
  assert.equal(legacy(WITHDRAW).messageType, WITHDRAW);
  assert.equal(legacy(WITHDRAW).grantee, BOT);
  assert.equal(legacy(WITHDRAW).bounded, false);
});

test('grant parsing rejects another owner, invalid grantee and malformed validator scope', () => {
  const api = load();
  assert.throws(() => api.parseGrant(grant({ granter: OTHER_BOT }), OWNER), /identity/);
  assert.throws(() => api.parseGrant(grant({ grantee: VALIDATOR }), OWNER), /identity/);
  const raw = grant(); raw.authorization.allow_list.address = [BOT];
  assert.throws(() => api.parseGrant(raw, OWNER), /scope/);
});

test('account reads preserve large height, stake and reward amounts without Number conversion', async () => {
  const api = load(fixtureFetch());
  const result = await api.loadAccount(ENDPOINT, CHAIN, OWNER);
  assert.equal(result.height, '9007199254740993');
  assert.equal(result.delegations[VALIDATOR], '9007199254740993');
  assert.equal(result.rewards[VALIDATOR], '9007199254740993');
  assert.equal(result.withdrawAddress, OWNER);
  assert.equal(result.grants[0].grantee, BOT);
  assert.deepEqual(plain(result.unavailable), []);
});

test('all ancillary API failures preserve successfully queried grants for revocation', async () => {
  const api = load(fixtureFetch({ delegations: new Error('offline'), rewards: new Error('HTTP 503'), withdraw: new Error('timeout') }));
  const result = await api.loadAccount(ENDPOINT, CHAIN, OWNER);
  assert.equal(result.grants[0].grantee, BOT);
  assert.equal(result.grants[0].messageType, DELEGATE);
  assert.deepEqual(plain(result.unavailable).sort(), ['delegations', 'reward withdrawal address', 'rewards']);
  assert.deepEqual(plain(result.delegations), {});
  assert.deepEqual(plain(result.rewards), {});
  assert.equal(result.withdrawAddress, '');
});

test('a malformed later delegation row does not publish a partial balance map', async () => {
  const api = load(fixtureFetch({ delegations: {
    delegation_responses: [delegation(), { ...delegation(OTHER_VALIDATOR), balance: { denom: 'aepix', amount: 'bad' } }],
  } }));
  const result = await api.loadAccount(ENDPOINT, CHAIN, OWNER);
  assert.equal(result.grants.length, 1);
  assert.deepEqual(plain(result.delegations), {});
  assert.deepEqual(plain(result.unavailable), ['delegations']);
  assert.equal(result.rewards[VALIDATOR], '9007199254740993');
});

test('a malformed later reward row does not publish a partial reward map', async () => {
  const api = load(fixtureFetch({ rewards: { rewards: [
    { validator_address: VALIDATOR, reward: [{ denom: 'aepix', amount: '1000.5' }] },
    { validator_address: OTHER_VALIDATOR, reward: [{ denom: 'aepix', amount: 'NaN' }] },
  ] } }));
  const result = await api.loadAccount(ENDPOINT, CHAIN, OWNER);
  assert.equal(result.grants.length, 1);
  assert.deepEqual(plain(result.rewards), {});
  assert.deepEqual(plain(result.unavailable), ['rewards']);
  assert.equal(result.delegations[VALIDATOR], '9007199254740993');
});

test('failed or malformed grant responses never turn into an empty successful grant list', async () => {
  for (const grants of [new Error('offline'), {}, { grants: [grant({ granter: OTHER_BOT })] }]) {
    await assert.rejects(load(fixtureFetch({ grants })).loadAccount(ENDPOINT, CHAIN, OWNER));
  }
});

test('endpoint chain mismatch prevents any account-specific requests', async () => {
  const calls = [];
  const api = load(fixtureFetch({ latest: { block: { header: { chain_id: 'epix_999-1', height: '1' } } } }, calls));
  await assert.rejects(api.loadAccount(ENDPOINT, CHAIN, OWNER), /does not match/);
  assert.equal(calls.length, 1);
});

test('paginated grants preserve all grantees and encode opaque continuation keys', async () => {
  const calls = [];
  const key = 'a+b/c==';
  const api = load(fixtureFetch({ grants: url => {
    const next = new URL(url).searchParams.get('pagination.key');
    if (!next) return { grants: [grant()], pagination: { next_key: key } };
    assert.equal(next, key);
    return { grants: [grant({ grantee: OTHER_BOT })], pagination: { next_key: null } };
  } }, calls));
  const result = await api.loadAccount(ENDPOINT, CHAIN, OWNER);
  assert.deepEqual(plain(result.grants.map(value => value.grantee)), [BOT, OTHER_BOT]);
  assert.equal(calls.filter(value => value.url.includes('/grants/granter/')).length, 2);
});

test('repeated pagination keys fail rather than presenting duplicate grants as a complete list', async () => {
  const api = load(fixtureFetch({ grants: { grants: [grant()], pagination: { next_key: 'same' } } }));
  await assert.rejects(api.loadAccount(ENDPOINT, CHAIN, OWNER), /pagination/);
});

test('validator activity requires a successful exact-grantee delegate action to the exact validator', () => {
  const api = load();
  const selected = api.parseOperator(operator(), 'fixture');
  const body = (grantee = BOT, validator = VALIDATOR) => ({ body: { messages: [{
    '@type': '/cosmos.authz.v1beta1.MsgExec', grantee,
    msgs: [{ '@type': DELEGATE, delegator_address: OWNER, validator_address: validator }],
  }] } });
  const receipt = code => ({ code, txhash: 'A'.repeat(64), timestamp: '2039-12-31T00:00:00Z' });
  for (const data of [
    { txs: [body()], tx_responses: [receipt('5')] },
    { txs: [body(OTHER_BOT)], tx_responses: [receipt('0')] },
    { txs: [body(BOT, OTHER_VALIDATOR)], tx_responses: [receipt('0')] },
  ]) assert.equal(api.parseActivity(data, selected), null);
  const result = api.parseActivity({ txs: [body()], tx_responses: [receipt('0')] }, selected);
  assert.equal(result.hash, 'A'.repeat(64));
  assert.equal(result.delegator, OWNER);
  assert.equal(result.validator, VALIDATOR);
  assert.throws(() => api.parseActivity({ txs: [body()], tx_responses: [] }, selected), /unavailable/);
});

test('validator eligibility rejects identity changes, jailed and non-bonded validators', async () => {
  for (const [validator, expected] of [
    [{ operator_address: VALIDATOR, jailed: false, status: 'BOND_STATUS_BONDED' }, true],
    [{ operator_address: VALIDATOR, jailed: true, status: 'BOND_STATUS_BONDED' }, false],
    [{ operator_address: VALIDATOR, jailed: false, status: 'BOND_STATUS_UNBONDED' }, false],
  ]) {
    const api = load(async () => new Response(JSON.stringify({ validator })));
    const details = await api.loadValidator(ENDPOINT, VALIDATOR);
    assert.equal(details.active, expected);
    assert.deepEqual(plain(details), { active: expected, moniker: '', identity: '', commission: '', jailed: validator.jailed });
  }
  const full = load(async () => new Response(JSON.stringify({ validator: {
    operator_address: VALIDATOR, jailed: false, status: 'BOND_STATUS_BONDED',
    description: { moniker: 'Example', identity: 'ABCDEF0123456789' },
    commission: { commission_rates: { rate: '0.050000000000000000' } },
  } })));
  assert.deepEqual(plain(await full.loadValidator(ENDPOINT, VALIDATOR)),
    { active: true, moniker: 'Example', identity: 'ABCDEF0123456789', commission: '0.050000000000000000', jailed: false });
  const api = load(async () => new Response(JSON.stringify({ validator: { operator_address: OTHER_VALIDATOR } })));
  await assert.rejects(api.loadValidator(ENDPOINT, VALIDATOR), /identity/);
});

test('fetch rejects HTTP failures, oversized responses and a canceled selection', async () => {
  await assert.rejects(load(async () => new Response('unavailable', { status: 503 })).fetchJson(ENDPOINT), /HTTP 503/);
  await assert.rejects(load(async () => new Response(' '.repeat(8 * 1024 * 1024 + 1))).fetchJson(ENDPOINT), /size limit/);
  const controller = new AbortController(); controller.abort();
  const api = load(async (_url, options) => {
    assert.equal(options.signal.aborted, true);
    throw new DOMException('Aborted', 'AbortError');
  });
  await assert.rejects(api.fetchJson(ENDPOINT, controller.signal), { name: 'AbortError' });
});

// Execute the actual component setup with Vue's reactive/watch implementation.
// Only the application stores, HTTP responses and lifecycle host are fixtures.
// Delayed HTTP fixtures deliberately ignore abort to exercise stale-result guards.
const vue = require('vue');
const sfc = require('@vue/compiler-sfc');
const componentFilename = resolve(__dirname, '../src/modules/[chain]/staking/autocompound.vue');
const descriptor = sfc.parse(readFileSync(componentFilename, 'utf8'), { filename: componentFilename }).descriptor;
const componentCode = ts.transpileModule(sfc.compileScript(descriptor, { id: 'autocompound-test' }).content, {
  fileName: componentFilename + '.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function settle() {
  for (let index = 0; index < 20; index++) await new Promise(resolve => setImmediate(resolve));
}

function componentFixture(overrides = {}, options = {}) {
  const first = operator({ name: 'Alpha' });
  const second = operator({ address: OTHER_VALIDATOR, name: 'Beta', restake: { ...operator().restake, address: OTHER_BOT } });
  const calls = [], opened = [], cleanup = [], replaced = [];
  const wallet = vue.reactive({ currentAddress: OWNER });
  const chain = vue.reactive({ current: { chainId: CHAIN }, endpoint: { address: ENDPOINT } });
  const route = vue.reactive({ path: '/staking/autocompound', query: { ...(options.query || {}) } });
  const txDialog = vue.reactive({ dialogOpen: false, openAndShow: (...args) => { opened.push(args); txDialog.dialogOpen = true; } });
  const paths = { [VALIDATOR]: 'Alpha/chains.json', [OTHER_VALIDATOR]: 'Beta/chains.json' };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    let key, value;
    if (parsed.pathname.endsWith('/autocompound/operators.json')) {
      key = 'snapshot';
      value = { revision: 'a'.repeat(40), entries: [first, second].map(item => ({
        name: item.name, path: paths[item.address], chain: { ...item, name: 'epix' },
      })) };
    } else if (parsed.hostname === 'validators.cosmos.directory') {
      key = 'directory'; value = { name: 'epix', validators: [first, second] };
    } else if (parsed.hostname === 'raw.githubusercontent.com') {
      key = 'raw';
      const item = parsed.pathname.includes('/Alpha/') ? first : second;
      value = { chains: [{ ...item, name: 'epix' }] };
    } else if (parsed.pathname.endsWith('/blocks/latest')) {
      key = 'latest'; value = { block: { header: { chain_id: CHAIN, height: '100' } } };
    } else if (parsed.pathname.includes('/grants/granter/')) {
      key = 'grants';
      const owner = parsed.pathname.split('/').pop();
      value = { grants: [grant({ granter: owner, grantee: owner === OWNER ? BOT : OTHER_BOT })] };
    } else if (parsed.pathname.includes('/delegations/')) {
      key = 'delegations';
      const owner = parsed.pathname.split('/').pop();
      value = { delegation_responses: [VALIDATOR, OTHER_VALIDATOR].map(validator => {
        const row = delegation(validator); row.delegation.delegator_address = owner; return row;
      }) };
    } else if (parsed.pathname.endsWith('/rewards')) {
      key = 'rewards'; value = { rewards: [VALIDATOR, OTHER_VALIDATOR].map(validator_address => ({
        validator_address, reward: [{ denom: 'aepix', amount: '1000000000000000000.5' }],
      })) };
    } else if (parsed.pathname.endsWith('/withdraw_address')) {
      key = 'withdraw'; value = { withdraw_address: parsed.pathname.split('/').at(-2) };
    } else if (parsed.pathname.includes('/staking/v1beta1/validators/')) {
      key = 'validator'; value = { validator: { operator_address: parsed.pathname.split('/').pop(),
        jailed: false, status: 'BOND_STATUS_BONDED' } };
    } else if (parsed.pathname.endsWith('/tx/v1beta1/txs')) {
      key = 'activity'; value = { txs: [], tx_responses: [] };
    } else if (parsed.pathname.endsWith('/epix/mint/v1beta1/inflation')) {
      key = 'inflation'; value = { inflation: '0.700000000000000000' };
    } else if (parsed.pathname.endsWith('/cosmos/distribution/v1beta1/params')) {
      key = 'distribution'; value = { params: { community_tax: '0.020000000000000000' } };
    } else if (parsed.pathname.endsWith('/cosmos/staking/v1beta1/pool')) {
      key = 'pool'; value = { pool: { bonded_tokens: '94' } };
    } else if (parsed.pathname.endsWith('/epix/mint/v1beta1/current_supply')) {
      key = 'supply'; value = { current_supply: '100' };
    } else if (parsed.pathname.endsWith('/cosmos/staking/v1beta1/params')) {
      key = 'stakingParams'; value = { params: { unbonding_time: '1814400s' } };
    } else {
      throw new Error('Unexpected component URL: ' + url);
    }
    if (Object.hasOwn(overrides, key)) {
      value = typeof overrides[key] === 'function' ? await overrides[key](url, value, options) : overrides[key];
    }
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value));
  };
  const api = load(fetch);
  const module = { exports: {} };
  const scope = vue.effectScope();
  // Only the stores the page needs unconditionally are provided; the staking
  // store and the router are optional in the page and only added on request.
  const customRequire = name => {
    if (name === 'vue') return { ...vue, onBeforeUnmount: callback => cleanup.push(callback) };
    if (name === 'vue-router') return options.router === false ? { useRoute: () => route }
      : { useRoute: () => route, useRouter: () => ({ replace: to => { replaced.push(to); return Promise.resolve(); } }) };
    if (name === '@/libs/autocompound') return api;
    if (name === '@/stores') return {
      useWalletStore: () => wallet, useBlockchain: () => chain, useTxDialog: () => txDialog,
      ...(options.staking ? { useStakingStore: () => options.staking } : {}),
    };
    return require(name);
  };
  vm.runInNewContext(componentCode, {
    module, exports: module.exports, require: customRequire, AbortController, URL,
    document: { baseURI: 'https://dashboard.epix/index.html#/staking/autocompound' },
    setInterval: () => 1, clearInterval: () => {},
    ...(options.globals || {}),
  }, { filename: componentFilename });
  const state = scope.run(() => module.exports.default.setup({}, { expose() {} }));
  return { state, wallet, chain, route, calls, opened, replaced, txDialog,
    dispose() { for (const callback of cleanup) callback(); scope.stop(); } };
}

test('component revalidates a bundled operator at its fixed GitHub path when the directory fails', async t => {
  const fixture = componentFixture({ directory: new Error('HTTP 403') });
  t.after(() => fixture.dispose());
  await settle();
  const { state, calls } = fixture;
  assert.equal(state.directoryFresh.value, false);
  assert.equal(state.operators.value.length, 2);
  assert.equal(state.selectedOperator.value.grantee, BOT);
  assert.equal(state.operatorFresh.value, true);
  assert.equal(state.grantBlocker.value, '');
  assert.ok(calls.some(call => call.url === 'https://raw.githubusercontent.com/eco-stake/validator-registry/master/Alpha/chains.json'));
  assert.ok(calls.every(call => !call.url.includes('http://')));
});

test('component allows revoke during registry and reward outages while blocking new grants', async t => {
  const fixture = componentFixture({ directory: new Error('HTTP 403'), raw: new Error('offline'), rewards: new Error('offline') });
  t.after(() => fixture.dispose());
  await settle();
  const { state, opened } = fixture;
  assert.equal(state.relevantGrants.value.length, 1);
  assert.ok(state.grantBlocker.value);
  let prevented = false;
  state.openGrant({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(opened.length, 0);
  state.openRevoke(state.relevantGrants.value[0], { preventDefault() { assert.fail('Revoke should remain available'); } });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'autocompound_revoke');
  assert.equal(opened[0][1].operator_address, BOT);
  assert.equal(opened[0][1].message_type, DELEGATE);
});

test('a late old selection response cannot change the newly selected operator or eligibility', async t => {
  const pending = deferred();
  const fixture = componentFixture({ directory: new Error('HTTP 403'), raw: async (url, value) => {
    if (url.includes('/Alpha/')) await pending.promise;
    return value;
  } });
  t.after(() => fixture.dispose());
  await settle();
  assert.equal(fixture.state.selected.value, VALIDATOR);
  fixture.state.selected.value = OTHER_VALIDATOR;
  await settle();
  assert.equal(fixture.state.selectedOperator.value.grantee, OTHER_BOT);
  assert.equal(fixture.state.validatorActive.value, true);
  pending.resolve();
  await settle();
  assert.equal(fixture.state.selectedOperator.value.grantee, OTHER_BOT);
  assert.equal(fixture.state.validatorActive.value, true);
  assert.equal(fixture.state.operatorError.value, '');
  fixture.state.openGrant({ preventDefault() { assert.fail('Current selection is eligible'); } });
  assert.equal(fixture.opened[0][1].operator_address, OTHER_BOT);
  assert.equal(fixture.opened[0][1].validator_address, OTHER_VALIDATOR);
});

test('late account responses cannot restore the previous wallet grants', async t => {
  const pending = deferred();
  const fixture = componentFixture({ grants: async (url, value) => {
    if (url.includes(OWNER)) await pending.promise;
    return value;
  } });
  t.after(() => fixture.dispose());
  await settle();
  fixture.wallet.currentAddress = OTHER_BOT;
  await settle();
  assert.equal(fixture.state.owner.value, OTHER_BOT);
  assert.equal(fixture.state.account.value.grants[0].grantee, OTHER_BOT);
  pending.resolve();
  await settle();
  assert.equal(fixture.state.account.value.grants[0].grantee, OTHER_BOT);
  assert.equal(fixture.state.accountLoading.value, false);
});

test('changed registry bot uses fresh consent while preserving the old exact grantee for revoke', async t => {
  const fixture = componentFixture({ directory: new Error('HTTP 403'), raw: (_url, value) => {
    value.chains[0].restake = { ...value.chains[0].restake, address: OTHER_BOT }; return value;
  } });
  t.after(() => fixture.dispose());
  await settle();
  assert.equal(fixture.state.selectedOperator.value.grantee, OTHER_BOT);
  assert.equal(fixture.state.selectedGrant.value, undefined);
  assert.match(fixture.state.operatorError.value, /address changed/);
  fixture.state.openGrant({ preventDefault() { assert.fail('Fresh operator is eligible'); } });
  fixture.state.openRevoke(fixture.state.relevantGrants.value[0], { preventDefault() { assert.fail('Old grant remains revocable'); } });
  assert.equal(fixture.opened[0][1].operator_address, OTHER_BOT);
  assert.equal(fixture.opened[0][1].existing_grant, false);
  assert.equal(fixture.opened[1][1].operator_address, BOT);
});

test('unmount invalidates pending registry and account responses', async () => {
  const pending = deferred();
  const fixture = componentFixture({ directory: async (_url, value) => { await pending.promise; return value; },
    grants: async (_url, value) => { await pending.promise; return value; } });
  await settle();
  fixture.dispose();
  pending.resolve();
  await settle();
  assert.equal(fixture.state.account.value, null);
  assert.equal(fixture.state.operators.value.length, 0);
});

test('registry refresh and expired metadata block new grants without disabling existing revocation', async t => {
  const pending = deferred();
  let count = 0;
  const fixture = componentFixture({ directory: async (_url, value) => {
    if (++count > 1) await pending.promise;
    return value;
  } });
  t.after(() => fixture.dispose());
  await settle();
  assert.equal(fixture.state.grantBlocker.value, '');
  fixture.state.now.value = fixture.state.checkedAt.value + 5 * 60 * 1000;
  assert.match(fixture.state.grantBlocker.value, /Couldn't verify Alpha's service listing/);
  fixture.state.now.value = Date.now();
  const refresh = fixture.state.refreshRegistry();
  assert.equal(fixture.state.registryLoading.value, true);
  let prevented = false;
  fixture.state.openGrant({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  fixture.state.openRevoke(fixture.state.relevantGrants.value[0], { preventDefault() { assert.fail('Existing revoke is independent'); } });
  assert.equal(fixture.opened[0][0], 'autocompound_revoke');
  pending.resolve();
  await refresh;
  await settle();
  assert.equal(fixture.state.grantBlocker.value, '');
});

test('removed registry entries stay unavailable for new grants while old grants remain revocable', async t => {
  const fixture = componentFixture({ directory: new Error('offline'), raw: { chains: [] } });
  t.after(() => fixture.dispose());
  await settle();
  assert.equal(fixture.state.operatorFresh.value, false);
  assert.ok(fixture.state.grantBlocker.value);
  assert.equal(fixture.state.relevantGrants.value[0].grantee, BOT);
  fixture.state.openRevoke(fixture.state.relevantGrants.value[0], { preventDefault() { assert.fail('Removed bot can still be revoked'); } });
  assert.equal(fixture.opened[0][1].operator_address, BOT);
});

test('viewing another account cannot open either grant or revoke dialogs', async t => {
  const fixture = componentFixture();
  t.after(() => fixture.dispose());
  await settle();
  fixture.route.query.account = OTHER_BOT;
  await settle();
  assert.equal(fixture.state.canManage.value, false);
  assert.equal(fixture.state.account.value.grants[0].grantee, OTHER_BOT);
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  fixture.state.openGrant(event);
  fixture.state.openRevoke(fixture.state.relevantGrants.value[0], event);
  assert.equal(prevented, 2);
  assert.equal(fixture.opened.length, 0);
});

test('other permissions retain their exact identity and type alongside legacy withdrawal cleanup', async t => {
  const send = '/cosmos.bank.v1beta1.MsgSend';
  const fixture = componentFixture({ grants: { grants: [
    grant(),
    grant({ grantee: OTHER_BOT, authorization: { '@type': GENERIC_AUTH, msg: send } }),
    grant({ authorization: { '@type': GENERIC_AUTH, msg: WITHDRAW } }),
  ] } });
  t.after(() => fixture.dispose());
  await settle();
  assert.equal(fixture.state.otherGrants.value.length, 1);
  assert.equal(fixture.state.otherGrants.value[0].grantee, OTHER_BOT);
  assert.equal(fixture.state.otherGrants.value[0].messageType, send);
  assert.equal(fixture.state.otherGrants.value[0].authorizationType, GENERIC_AUTH);
  const withdrawal = fixture.state.relevantGrants.value.find(value => value.messageType === WITHDRAW);
  fixture.state.openRevoke(withdrawal, { preventDefault() { assert.fail('Legacy cleanup is available'); } });
  assert.equal(fixture.opened[0][1].message_type, WITHDRAW);
  assert.equal(fixture.opened[0][1].operator_address, BOT);
});

test('actual local chain conversion carries configured mainnet and testnet identity into page state', () => {
  const sourceName = resolve(__dirname, '../src/stores/useDashboard.ts');
  const ast = ts.createSourceFile(sourceName, readFileSync(sourceName, 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ['apiConverter', 'convertFromLocal'].includes(node.name?.text));
  assert.equal(functions.length, 2);
  const code = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, URL,
    document: { baseURI: 'https://dashboard.epix/index.html' } });
  for (const [network, expected] of [['mainnet', 'epix_1916-1'], ['testnet', 'epix_1917-1']]) {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../chains', network, 'epix.json'), 'utf8'));
    const converted = module.exports.convertFromLocal(config);
    assert.equal(converted.chainId, expected);
    assert.equal(converted.bech32Prefix, 'epix');
    delete config.chain_id;
    assert.equal(module.exports.convertFromLocal(config).chainId, '');
  }
});

// ---------------------------------------------------------------------------
// Redesign helpers (spec section 6, A01, A02, A16, A22, 10.2, 10.3)
// ---------------------------------------------------------------------------
const EPIX = '000000000000000000';
const epix = whole => String(whole) + EPIX;
const FORBIDDEN = /\b(paused|spending|authorization|grantee|operator)\b/i;

function parsedGrant(api, overrides = {}, mutate = () => {}) {
  const raw = grant(overrides);
  mutate(raw);
  return api.parseGrant(raw, OWNER);
}

function statusInput(api, overrides = {}) {
  return {
    row: { validator: VALIDATOR, name: 'Alpha', stake: epix(1000), rewards: '0' },
    operator: api.parseOperator(operator(), 'fixture'), grants: [], registry: 'ready', validatorActive: null,
    pending: null, apr: '0.70', unbondingSeconds: '1814400', now: NOW, ...overrides,
  };
}

test('bech32-aware short addresses keep the prefix, four data characters and the last six', () => {
  const api = load();
  assert.equal(api.shortAddress(OWNER), 'epix1' + OWNER.slice(5, 9) + '…' + OWNER.slice(-6));
  assert.equal(api.shortAddress(VALIDATOR), 'epixvaloper1' + VALIDATOR.slice(12, 16) + '…' + VALIDATOR.slice(-6));
  assert.equal(api.shortAddress('abcdefghijklmnopqrstuvwxyz'), 'abcdefghij…uvwxyz');
  assert.equal(api.shortAddress('short'), 'short');
  assert.equal(api.shortAddress(''), '');
});

test('pending authorization keys pin the exact widget storage format and tolerate malformed entries', () => {
  const api = load();
  const key = api.pendingAuthorizationKey(CHAIN, OWNER, BOT, DELEGATE);
  assert.equal(key, 'epix:pending-authorization:' + JSON.stringify([CHAIN, OWNER, BOT, DELEGATE]));
  assert.equal(key, `epix:pending-authorization:["epix_1916-1","${OWNER}","${BOT}","/cosmos.staking.v1beta1.MsgDelegate"]`);
  const entry = { hash: 'A'.repeat(64), action: 'autocompound', createdAt: 1, timeoutHeight: '10' };
  assert.deepEqual(plain(api.parsePendingAuthorization(JSON.stringify(entry))), entry);
  for (const raw of [null, undefined, '', 'not json', JSON.stringify({ ...entry, hash: 'a'.repeat(64) }),
    JSON.stringify({ ...entry, action: 'send' }), JSON.stringify({ ...entry, timeoutHeight: '0' }), JSON.stringify({ ...entry, createdAt: '1' })]) {
    assert.equal(api.parsePendingAuthorization(raw), null, String(raw));
  }
});

test('schedules read as plain words with singular and plural normalisation and interval hours', () => {
  const api = load();
  assert.equal(api.humanSchedule(['every 1 hour']), 'Runs every hour');
  assert.equal(api.humanSchedule(['every 1 hours']), 'Runs every hour');
  assert.equal(api.humanSchedule(['every 3 hour']), 'Runs every 3 hours');
  assert.equal(api.humanSchedule(['every 5 minutes']), 'Runs every 5 minutes');
  assert.equal(api.humanSchedule(['every 0.5 hours']), 'Runs every 30 minutes');
  assert.equal(api.humanSchedule(['2:00']), 'Runs daily at 02:00 UTC');
  assert.equal(api.humanSchedule(['02:00', '14:00']), 'Runs daily at 02:00 and 14:00 UTC');
  assert.equal(api.humanSchedule(['02:00', '08:00', '14:00']), 'Runs daily at 02:00, 08:00 and 14:00 UTC');
  assert.equal(api.humanSchedule([]), 'Runs on its own schedule');
  assert.equal(api.intervalHours(['every 5 minutes']), 1 / 12);
  assert.equal(api.intervalHours(['every 2 days']), 48);
  assert.equal(api.intervalHours(['02:00', '14:00']), 12);
  assert.equal(api.intervalHours([]), null);
});

test('relative times and amounts are short, exact and never rounded up from zero', () => {
  const api = load();
  assert.equal(api.relativeTime(new Date(NOW - 10000).toISOString(), NOW), 'just now');
  assert.equal(api.relativeTime(new Date(NOW - 4 * 60000).toISOString(), NOW), '4 min ago');
  assert.equal(api.relativeTime(new Date(NOW - 3 * 3600000).toISOString(), NOW), '3 h ago');
  assert.equal(api.relativeTime(new Date(NOW - 2 * 86400000).toISOString(), NOW), '2 d ago');
  assert.equal(api.relativeTime(new Date(NOW - 8 * 86400000).toISOString(), NOW), api.formatDate(NOW - 8 * 86400000));
  assert.equal(api.relativeTime('nope', NOW), '');
  assert.equal(api.formatAmount(epix(296829)), '296,829');
  assert.equal(api.formatAmount('1190000000000000000'), '1.19');
  assert.equal(api.formatAmount('1199999999999999999', 4), '1.1999');
  assert.equal(api.formatAmount('1'), '<0.01');
  assert.equal(api.formatAmount('0'), '0');
  assert.equal(api.formatAmount(null), '');
  // Card lines pad to two decimals so numbers line up; "<0.01" and truncation stay.
  assert.equal(api.formatFixed(epix(296829)), '296,829.00');
  assert.equal(api.formatFixed('6119400000000000000000'), '6,119.40');
  assert.equal(api.formatFixed('1199999999999999999'), '1.19');
  assert.equal(api.formatFixed('10000000000000000'), '0.01');
  assert.equal(api.formatFixed('1'), '<0.01');
  assert.equal(api.formatFixed('0'), '0.00');
  assert.equal(api.formatFixed(epix(5), 0), '5');
  assert.equal(api.formatFixed(null), '');
  assert.equal(api.formatDate('2027-01-31T12:00:00Z').length > 0, true);
});

test('staking APR derives from inflation, community tax, bonded ratio and commission, or degrades to unknown', async () => {
  const chainFetch = (overrides = {}) => async url => {
    const path = new URL(url).pathname;
    const rows = {
      '/epix/mint/v1beta1/inflation': { inflation: '0.700000000000000000' },
      '/cosmos/distribution/v1beta1/params': { params: { community_tax: '0.020000000000000000' } },
      '/cosmos/staking/v1beta1/pool': { pool: { bonded_tokens: '94' } },
      '/epix/mint/v1beta1/current_supply': { current_supply: '100' },
      '/cosmos/staking/v1beta1/params': { params: { unbonding_time: '1814400s' } },
      ...overrides,
    };
    const value = rows[path];
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value));
  };
  assert.equal(await load(chainFetch()).loadApr(ENDPOINT), '0.729787');
  assert.equal(await load(chainFetch({ '/cosmos/staking/v1beta1/pool': new Error('offline') })).loadApr(ENDPOINT), '');
  assert.equal(await load(chainFetch({ '/epix/mint/v1beta1/inflation': { inflation: '1e3' } })).loadApr(ENDPOINT), '');
  assert.equal(await load(chainFetch({ '/cosmos/staking/v1beta1/pool': { pool: { bonded_tokens: '1' } } })).loadApr(ENDPOINT), '');
  assert.equal(await load(chainFetch()).loadUnbondingSeconds(ENDPOINT), '1814400');
  assert.equal(await load(chainFetch({ '/cosmos/staking/v1beta1/params': { params: {} } })).loadUnbondingSeconds(ENDPOINT), '');
  const api = load();
  assert.equal(api.validatorApr('0.70', '0.100000000000000000'), '0.63');
  assert.equal(api.validatorApr('0.70', ''), '0.7');
  assert.equal(api.validatorApr('', '0.1'), '');
});

test('threshold estimates are linear in stake and APR and stay exact for large amounts', () => {
  const api = load();
  assert.equal(api.daysToThreshold(epix(1), '0', epix(1000), '0.73'), 0.5);
  assert.equal(api.daysToThreshold(epix(1), epix(1), epix(1000), '0.73'), 0);
  assert.equal(api.daysToThreshold(epix(1), '0', epix(1000), ''), null);
  assert.equal(api.daysToThreshold(null, '0', epix(1000), '0.73'), null);
  assert.equal(api.daysToThreshold(epix(1), '0', '1', '0.73'), Infinity);
  assert.equal(api.daysToThreshold('1' + '0'.repeat(40), '0', '9007199254740993', '0.73') > 1e9, true);
  assert.equal(api.humanThreshold(epix(10), epix(1000), '0', '0.73', ['every 1 hour']),
    'Re-stakes once rewards reach 10 EPIX, about every 5 days at your stake.');
  assert.equal(api.humanThreshold(epix(10), epix(1000), '0', '', ['every 1 hour']), 'Re-stakes once rewards reach 10 EPIX.');
  assert.equal(api.humanThreshold(null, epix(1000), '0', '0.73', []), 'Minimum reward not stated by the service.');
  assert.equal(api.humanThreshold('1', epix(1000), '0', '0.73', ['every 1 hour']), 'Re-stakes on every run (every hour).');
  assert.equal(api.humanThreshold(epix(10000), epix(1000), '0', '0.73', []),
    'Re-stakes once rewards reach 10,000 EPIX, about every 14 years at your stake.');
  // not_running: with APR the window is 3 × interval + 6 hours; without it, 1% of stake.
  assert.equal(api.notRunning(epix(1000), epix(50), '0.70', 1, epix(1)), true);
  assert.equal(api.notRunning(epix(1000), '500000000000000000', '0.70', 1, epix(1)), false);
  assert.equal(api.notRunning(epix(1000), epix(50), '', 1, epix(1)), true);
  assert.equal(api.notRunning(epix(1000), epix(5), '', 1, epix(1)), false);
  assert.equal(api.notRunning(epix(1000), epix(50), '0.70', 1, null), false);
  assert.equal(api.notRunning(epix(1000), null, '0.70', 1, epix(1)), false);
});

test('recent activity prefers the owner delegation inside a batched execution', () => {
  const api = load();
  const selected = api.parseOperator(operator(), 'fixture');
  const exec = delegators => ({ body: { messages: [{ '@type': '/cosmos.authz.v1beta1.MsgExec', grantee: BOT,
    msgs: delegators.map(delegator_address => ({ '@type': DELEGATE, delegator_address, validator_address: VALIDATOR })) }] } });
  const receipt = { code: '0', txhash: 'B'.repeat(64), timestamp: '2039-12-31T00:00:00Z' };
  assert.equal(api.parseActivity({ txs: [exec([OTHER_BOT, OWNER])], tx_responses: [receipt] }, selected, OWNER).delegator, OWNER);
  assert.equal(api.parseActivity({ txs: [exec([OTHER_BOT])], tx_responses: [receipt] }, selected, OWNER).delegator, OTHER_BOT);
  assert.equal(api.parseActivity({ txs: [exec([OTHER_BOT, OWNER])], tx_responses: [receipt] }, selected).delegator, OTHER_BOT);
});

test('activity pages count every transaction, honour the page size and keep the legacy loader', async () => {
  const urls = [];
  const exec = (grantee, delegator, validator) => ({ body: { messages: [{ '@type': '/cosmos.authz.v1beta1.MsgExec', grantee,
    msgs: [{ '@type': DELEGATE, delegator_address: delegator, validator_address: validator }] }] } });
  const receipt = (code, hash) => ({ code, txhash: hash, timestamp: '2039-12-31T00:00:00Z' });
  // A failed execution still counts as a transaction; only a successful one counts as a re-stake.
  const page = { txs: [exec(BOT, OWNER, VALIDATOR), exec(BOT, OTHER_BOT, VALIDATOR)],
    tx_responses: [receipt('5', 'A'.repeat(64)), receipt('0', 'B'.repeat(64))] };
  const api = load(async url => { urls.push(url); return new Response(JSON.stringify(page)); });
  const selected = api.parseOperator(operator(), 'fixture');
  const result = await api.loadActivityPage(ENDPOINT, selected, undefined, OWNER, 10);
  assert.equal(result.txCount, 2);
  assert.equal(result.activity.hash, 'B'.repeat(64));
  assert.equal(result.activity.delegator, OTHER_BOT);
  const query = new URL(urls[0]).searchParams;
  assert.equal(query.get('pagination.limit'), '10');
  assert.equal(query.get('query'), "message.sender='" + BOT + "'");
  assert.equal(query.get('order_by'), 'ORDER_BY_DESC');
  assert.equal((await api.loadActivity(ENDPOINT, selected)).hash, 'B'.repeat(64));
  assert.equal(new URL(urls[1]).searchParams.get('pagination.limit'), '20');
  assert.equal((await api.loadActivityPage(ENDPOINT, selected)).txCount, 2);
  assert.equal(new URL(urls[2]).searchParams.get('pagination.limit'), '20');
  for (const limit of [0, 101, 1.5, '10']) await assert.rejects(api.loadActivityPage(ENDPOINT, selected, undefined, '', limit), /page size/);
  assert.deepEqual(plain(api.parseActivityPage({ txs: [], tx_responses: [] }, selected)), { activity: null, txCount: 0 });
  assert.throws(() => api.parseActivityPage({ txs: [{}], tx_responses: [] }, selected), /unavailable/);
});

test('service health allows three schedule intervals plus six hours, at least a day, and never judges a failed query', () => {
  const api = load();
  const ago = hours => new Date(NOW - hours * 3600000).toISOString();
  const health = (iso, txCount, schedule) => plain(api.activityHealth(iso, txCount, schedule, NOW));
  assert.deepEqual(health(ago(1), 5, ['every 1 hour']), { state: 'recent', maxGapHours: 24 });
  assert.deepEqual(health(ago(24), 5, ['every 1 hour']), { state: 'recent', maxGapHours: 24 });
  assert.deepEqual(health(ago(24.01), 5, ['every 1 hour']), { state: 'stale', maxGapHours: 24 });
  assert.deepEqual(health(ago(41), 5, ['every 12 hours']), { state: 'recent', maxGapHours: 42 });
  assert.deepEqual(health(ago(43), 5, ['every 12 hours']), { state: 'stale', maxGapHours: 42 });
  assert.deepEqual(health(ago(100), 5, ['every 2 days']), { state: 'recent', maxGapHours: 150 });
  assert.deepEqual(health(ago(41), 5, ['02:00', '14:00']), { state: 'recent', maxGapHours: 42 });
  // No readable interval: a day is assumed for the verdict, and the gap is reported as unknown.
  assert.deepEqual(health(ago(23), 5, []), { state: 'recent', maxGapHours: null });
  assert.deepEqual(health(ago(25), 5, []), { state: 'stale', maxGapHours: null });
  assert.deepEqual(health(null, 0, ['every 1 hour']), { state: 'silent', maxGapHours: 24 });
  assert.deepEqual(health(null, 7, ['every 1 hour']), { state: 'silent', maxGapHours: 24 });
  assert.deepEqual(health('nope', 7, ['every 1 hour']), { state: 'silent', maxGapHours: 24 });
  assert.deepEqual(health(null, null, ['every 1 hour']), { state: 'unknown', maxGapHours: 24 });
  assert.deepEqual(health(ago(1), null, ['every 1 hour']), { state: 'unknown', maxGapHours: 24 });
});

test('a stale or silent service turns a plain On row into Not re-staking, after every other rule', () => {
  const api = load();
  const enough = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = epix(1000); });
  const at = new Date(NOW - 48 * 3600000).toISOString();
  const stale = api.delegationStatus(statusInput(api, { grants: [enough], lastRun: { at, state: 'stale' } }));
  assert.equal(stale.kind, 'not_running');
  assert.equal(stale.label, 'Not re-staking');
  assert.equal(stale.icon, 'mdi:alert-circle-outline');
  assert.equal(stale.text, 'Permission is on, but this service last re-staked for anyone 2 d ago, longer than its schedule (every hour) allows. It may not be running.');
  assert.equal(stale.primary.action, 'check_service');
  assert.deepEqual(plain(stale.secondary.map(action => action.action)), ['turn_off']);
  const silent = api.delegationStatus(statusInput(api, { grants: [enough], lastRun: { at: null, state: 'silent' } }));
  assert.equal(silent.kind, 'not_running');
  assert.equal(silent.text, "Permission is on, but this service hasn't re-staked for anyone in its recent transactions. It may not be running.");
  assert.equal(silent.primary.action, 'check_service');
  for (const text of [stale.text, silent.text]) assert.doesNotMatch(text, FORBIDDEN);
  for (const lastRun of [null, undefined, { at, state: 'recent' }, { at: null, state: 'unknown' }]) {
    assert.equal(api.delegationStatus(statusInput(api, { grants: [enough], lastRun })).kind, 'on', JSON.stringify(lastRun));
  }
  // The reward-based rule keeps precedence and its own copy.
  const rewards = api.delegationStatus(statusInput(api, { grants: [enough], lastRun: { at, state: 'recent' },
    row: { validator: VALIDATOR, name: 'Alpha', stake: epix(1000), rewards: epix(50) } }));
  assert.equal(rewards.kind, 'not_running');
  assert.match(rewards.text, /50 EPIX of rewards .* are waiting/);
  // Only a row that would otherwise be plain On is affected.
  const silentRun = { at: null, state: 'silent' };
  const soon = new Date(NOW + 6 * 86400000).toISOString();
  const expiring = parsedGrant(api, { expiration: soon }, raw => { raw.authorization.max_tokens.amount = epix(1000); });
  assert.equal(api.delegationStatus(statusInput(api, { grants: [expiring], lastRun: silentRun })).kind, 'expiring');
  assert.equal(api.delegationStatus(statusInput(api, { grants: [enough], operator: null, lastRun: silentRun })).kind, 'on_unlisted');
  assert.equal(api.delegationStatus(statusInput(api, { grants: [enough], registry: 'unavailable', lastRun: silentRun })).kind, 'on_unlisted');
  assert.equal(api.delegationStatus(statusInput(api, { grants: [enough], validatorActive: false, lastRun: silentRun })).kind, 'validator_inactive');
  assert.equal(api.delegationStatus(statusInput(api, { lastRun: silentRun })).kind, 'off');
});

test('status is grant-first: a live grant stays on while the registry loads, fails or drops the validator', () => {
  const api = load();
  const live = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = epix(1000); });
  const loading = api.delegationStatus(statusInput(api, { registry: 'loading', operator: null, grants: [live] }));
  assert.equal(loading.kind, 'on_unlisted');
  const unavailable = api.delegationStatus(statusInput(api, { registry: 'unavailable', operator: null, grants: [live] }));
  assert.equal(unavailable.kind, 'on_unlisted');
  assert.match(unavailable.text, /Couldn't check the service list/);
  assert.deepEqual(plain(unavailable.secondary.map(action => action.action)), ['turn_off']);
  const dropped = api.delegationStatus(statusInput(api, { operator: null, grants: [live] }));
  assert.equal(dropped.kind, 'on_unlisted');
  assert.match(dropped.text, /no longer in the public list/);
  assert.equal(api.delegationStatus(statusInput(api, { registry: 'loading' })).kind, 'checking');
  assert.equal(api.delegationStatus(statusInput(api, { registry: 'unavailable', operator: null })).kind, 'unknown');
  assert.equal(api.delegationStatus(statusInput(api, { operator: null })).kind, 'not_offered');
});

test('a grant to an old service account is never on and ends in a two-step repair', () => {
  const api = load();
  const old = parsedGrant(api, { grantee: OTHER_BOT });
  const stale = api.delegationStatus(statusInput(api, { grants: [old], validatorActive: false }));
  assert.equal(stale.kind, 'stale_permission');
  assert.equal(stale.primary.action, 'turn_off');
  assert.equal(stale.primary.grant.grantee, OTHER_BOT);
  assert.match(stale.text, /Step 1 of 2/);
  const step2 = api.delegationStatus(statusInput(api, { staleStepTwo: true }));
  assert.equal(step2.kind, 'stale_permission');
  assert.equal(step2.primary.action, 'turn_on');
  assert.match(step2.text, /Step 2 of 2/);
});

test('limit reached covers a remainder below the accrued reward or the service minimum', () => {
  const api = load();
  const below = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = epix(2); });
  const reached = api.delegationStatus(statusInput(api, { grants: [below], row: { validator: VALIDATOR, name: 'Alpha', stake: epix(1000), rewards: epix(5) } }));
  assert.equal(reached.kind, 'limit_reached');
  assert.match(reached.text, /2 EPIX left, 5 EPIX of rewards waiting/);
  assert.equal(reached.primary.action, 'raise_limit');
  const zero = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = '0'; });
  assert.equal(api.delegationStatus(statusInput(api, { grants: [zero] })).kind, 'limit_reached');
  const belowMinimum = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = '999999999999999999'; });
  assert.equal(api.delegationStatus(statusInput(api, { grants: [belowMinimum] })).kind, 'limit_reached');
  const enough = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = epix(1000); });
  assert.equal(api.delegationStatus(statusInput(api, { grants: [enough] })).kind, 'on');
});

test('service effectiveness: not re-staking with and without an APR, and a minimum the stake never reaches', () => {
  const api = load();
  const enough = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = epix(1000); });
  const row = rewards => ({ validator: VALIDATOR, name: 'Alpha', stake: epix(1000), rewards });
  const withApr = api.delegationStatus(statusInput(api, { grants: [enough], row: row(epix(50)) }));
  assert.equal(withApr.kind, 'not_running');
  assert.match(withApr.text, /50 EPIX of rewards \(about 26 days' worth\) are waiting/);
  assert.equal(withApr.primary.action, 'check_service');
  assert.equal(api.delegationStatus(statusInput(api, { grants: [enough], row: row(epix(50)), apr: '' })).kind, 'not_running');
  assert.equal(api.delegationStatus(statusInput(api, { grants: [enough], row: row(epix(5)), apr: '' })).kind, 'on');
  assert.equal(api.delegationStatus(statusInput(api, { grants: [enough], row: row('500000000000000000') })).kind, 'on');
  const picky = api.parseOperator(operator({ restake: { ...operator().restake, minimum_reward: epix(10000) } }), 'fixture');
  const yearly = parsedGrant(api, { expiration: new Date(NOW + 365 * 86400000).toISOString() }, raw => { raw.authorization.max_tokens.amount = epix(100000); });
  const never = api.delegationStatus(statusInput(api, { operator: picky, grants: [yearly] }));
  assert.equal(never.kind, 'on_below_minimum');
  assert.equal(never.label, "Won't run");
  assert.match(never.text, /about 14 years/);
  assert.deepEqual(plain([never.primary.action, ...never.secondary.map(action => action.action)]), ['move_stake', 'turn_off']);
  const headsUp = api.delegationStatus(statusInput(api, { operator: picky }));
  assert.equal(headsUp.kind, 'off');
  assert.match(headsUp.text, /Heads-up: this service only re-stakes once rewards reach 10,000 EPIX, about 14 years at your stake/);
});

test('ends soon wins over a low limit and both carry their own repair actions', () => {
  const api = load();
  const soon = new Date(NOW + 6 * 86400000).toISOString();
  const both = parsedGrant(api, { expiration: soon }, raw => { raw.authorization.max_tokens.amount = epix(10); });
  const expiring = api.delegationStatus(statusInput(api, { grants: [both] }));
  assert.equal(expiring.kind, 'expiring');
  assert.equal(expiring.label, 'Ends soon');
  assert.match(expiring.text, /^Ends in 6 days \(/);
  assert.equal(expiring.primary.action, 'renew');
  const low = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = epix(10); });
  const limitLow = api.delegationStatus(statusInput(api, { grants: [low] }));
  assert.equal(limitLow.kind, 'limit_low');
  assert.match(limitLow.text, /About 5 days of rewards left/);
  assert.equal(limitLow.primary.action, 'raise_limit');
  assert.equal(api.delegationStatus(statusInput(api, { grants: [low], apr: '' })).kind, 'on');
});

test('healthy, off, ended and inactive rows read as switches with quiet or filled actions', () => {
  const api = load();
  const enough = parsedGrant(api, {}, raw => { raw.authorization.max_tokens.amount = epix(1000); });
  const on = api.delegationStatus(statusInput(api, { grants: [enough] }));
  assert.equal(on.kind, 'on');
  assert.equal(on.primary, null);
  assert.deepEqual(plain(on.secondary.map(action => action.action)), ['change', 'turn_off']);
  assert.match(on.text, /^Until .* · can still re-stake up to 1,000 EPIX$/);
  const unlimited = parsedGrant(api, {}, raw => { delete raw.authorization.max_tokens; });
  assert.match(api.delegationStatus(statusInput(api, { grants: [unlimited] })).text, /· no limit$/);
  const off = api.delegationStatus(statusInput(api));
  assert.equal(off.kind, 'off');
  assert.equal(off.primary.label, 'Turn on');
  assert.equal(off.text, '');
  const waiting = api.delegationStatus(statusInput(api, { row: { validator: VALIDATOR, name: 'Alpha', stake: epix(1000), rewards: epix(2) } }));
  assert.match(waiting.text, /2 EPIX of rewards are waiting; turn on/);
  const remembered = api.delegationStatus(statusInput(api, { remembered: '2039-06-01T00:00:00Z' }));
  assert.equal(remembered.primary.label, 'Turn on again');
  assert.match(remembered.text, /Your permission ended on/);
  assert.equal(api.delegationStatus(statusInput(api, { remembered: FUTURE })).primary.label, 'Turn on');
  const ended = parsedGrant(api, { expiration: '2039-01-31T00:00:00Z' });
  const expired = api.delegationStatus(statusInput(api, { grants: [ended], validatorActive: false }));
  assert.equal(expired.kind, 'expired');
  assert.equal(expired.label, 'Ended');
  assert.equal(expired.primary.label, 'Turn on again');
  assert.equal(expired.secondary[0].action, 'remove_ended');
  const inactive = api.delegationStatus(statusInput(api, { grants: [enough], validatorActive: false }));
  assert.equal(inactive.kind, 'validator_inactive');
  assert.equal(inactive.primary, null);
  assert.deepEqual(plain(inactive.secondary.map(action => action.action)), ['turn_off', 'move_stake']);
  assert.deepEqual(plain(api.delegationStatus(statusInput(api, { validatorActive: false })).secondary.map(action => action.action)), ['move_stake']);
  const pending = api.delegationStatus(statusInput(api, { grants: [enough], pending: 'turn_off', registry: 'loading' }));
  assert.equal(pending.kind, 'pending');
  assert.equal(pending.primary.action, 'check_status');
  const leftover = api.leftoverStatus(enough, 'Gamma', NOW);
  assert.equal(leftover.label, 'Leftover');
  assert.equal(leftover.primary.action, 'turn_off');
  assert.match(leftover.text, /You no longer stake with Gamma/);
  assert.equal(api.leftoverStatus(ended, 'Gamma', NOW).primary.action, 'remove_ended');
});

test('status precedence follows the specified order and the copy avoids protocol vocabulary', () => {
  const api = load();
  const soon = new Date(NOW + 6 * 86400000).toISOString();
  const cap = amount => raw => { raw.authorization.max_tokens.amount = amount; };
  const picky = api.parseOperator(operator({ restake: { ...operator().restake, minimum_reward: epix(10000) } }), 'fixture');
  const row = rewards => ({ validator: VALIDATOR, name: 'Alpha', stake: epix(1000), rewards });
  const steps = [
    ['checking', { registry: 'loading' }],
    ['pending', { pending: 'turn_on', grants: [parsedGrant(api, { grantee: OTHER_BOT })], validatorActive: false }],
    ['stale_permission', { grants: [parsedGrant(api, { grantee: OTHER_BOT }), parsedGrant(api, { expiration: '2039-01-01T00:00:00Z' })], validatorActive: false }],
    ['expired', { grants: [parsedGrant(api, { expiration: '2039-01-01T00:00:00Z' })], validatorActive: false }],
    ['validator_inactive', { grants: [parsedGrant(api, {}, cap('0'))], validatorActive: false, row: row(epix(50)) }],
    ['limit_reached', { grants: [parsedGrant(api, { expiration: soon }, cap('0'))], row: row(epix(50)) }],
    ['not_running', { grants: [parsedGrant(api, { expiration: soon }, cap(epix(1000)))], row: row(epix(50)) }],
    ['on_below_minimum', { operator: picky, grants: [parsedGrant(api, { expiration: soon }, cap(epix(100000)))] }],
    ['expiring', { grants: [parsedGrant(api, { expiration: soon }, cap(epix(10)))] }],
    ['limit_low', { grants: [parsedGrant(api, {}, cap(epix(10)))], lastRun: { at: null, state: 'silent' } }],
    ['on_unlisted', { grants: [parsedGrant(api, {}, cap(epix(1000)))], operator: null, lastRun: { at: null, state: 'silent' } }],
    ['not_running', { grants: [parsedGrant(api, {}, cap(epix(1000)))], lastRun: { at: null, state: 'silent' } }],
    ['on', { grants: [parsedGrant(api, {}, cap(epix(1000)))], lastRun: { at: new Date(NOW - 3600000).toISOString(), state: 'recent' } }],
    ['off', {}],
    ['unknown', { registry: 'unavailable', operator: null }],
    ['not_offered', { operator: null }],
  ];
  const seen = [];
  for (const [kind, overrides] of steps) {
    const result = api.delegationStatus(statusInput(api, overrides));
    assert.equal(result.kind, kind);
    assert.ok(result.label.split(' ').length <= 2, result.label);
    assert.ok(result.icon.startsWith('mdi:'), kind);
    assert.doesNotMatch(result.text, FORBIDDEN, kind + ': ' + result.text);
    seen.push(kind);
  }
  assert.deepEqual(plain(seen), steps.map(([kind]) => kind));
  assert.deepEqual(plain(seen.map(kind => api.statusGroup(kind, true))), ['other', 'ready', 'attention', 'attention', 'attention',
    'attention', 'attention', 'attention', 'attention', 'attention', 'on', 'attention', 'on', 'ready', 'other', 'other']);
  assert.equal(api.statusGroup('validator_inactive', false), 'other');
});

// ---------------------------------------------------------------------------
// Component: redesign flows (A03, A04, A05, A12, A13, A14, 10.2, 10.7)
// ---------------------------------------------------------------------------
test('component derives rows, groups and chips from the account and never preselects an unstaked registry entry', async t => {
  const fixture = componentFixture();
  t.after(() => fixture.dispose());
  await settle();
  const { state } = fixture;
  assert.deepEqual(plain(state.rows.value.map(row => [row.name, row.status.kind])), [['Alpha', 'not_running'], ['Beta', 'off']]);
  assert.equal(state.rows.value[0].apr, '0.729787');
  assert.equal(state.selected.value, VALIDATOR);
  assert.deepEqual(plain(state.sections.value.map(section => [section.key, section.rows.length])), [['attention', 1], ['ready', 1]]);
  // "All" carries no number; the other chips count what their group lists.
  assert.deepEqual(plain(state.chips.value.map(chipText)), ['All', 'Needs attention 1', 'Ready 1']);
  assert.equal(state.leftovers.value.length, 0);
  assert.equal(state.unbondingSeconds.value, '1814400');
  assert.equal(state.registryState.value, 'ready');
  // The sentence comes from the same counts as the chips and headings: nothing
  // sits in "On", one row is on but flagged.
  assert.equal(state.statusText.value, 'Loaded. 1 of your 2 validators is on but needs attention.');
  assert.equal(state.onCount.value, 1);
  assert.equal(state.counts.value.on, 0);
  assert.equal(state.counts.value.flagged, 1);

  const only = componentFixture({ delegations: { delegation_responses: [delegation(OTHER_VALIDATOR)] } });
  t.after(() => only.dispose());
  await settle();
  assert.equal(only.state.summary.value, 'Auto-compound is off. 1 of your 1 validator can be turned on.');
  assert.equal(only.state.selected.value, OTHER_VALIDATOR);
  assert.equal(only.state.rows.value.length, 1);
  assert.equal(only.state.leftovers.value.length, 1);
  assert.equal(only.state.leftovers.value[0].grant.grantee, BOT);
  assert.equal(only.state.leftovers.value[0].status.label, 'Leftover');
  assert.match(only.state.leftovers.value[0].status.text, /Turn it off unless you plan to stake here again\.$/);
  // The leftover permission is listed inside "Needs attention", whose heading
  // counts it exactly like the chip does.
  assert.deepEqual(plain(only.state.sections.value.map(section => [section.key, section.title, section.rows.length, section.total])),
    [['attention', 'Needs attention', 0, 1], ['ready', 'Ready to turn on', 1, 1]]);
  assert.deepEqual(plain(only.state.chips.value.map(chipText)), ['All', 'Needs attention 1', 'Ready 1']);
  only.state.selectFilter('ready');
  assert.deepEqual(plain(only.state.sections.value.map(section => section.key)), ['ready']);
  only.state.selectFilter('attention');
  assert.deepEqual(plain(only.state.sections.value.map(section => section.key)), ['attention']);
});

test('component passes the display parameters the dialog needs and sets existing_grant only for live grants', async t => {
  const fixture = componentFixture();
  t.after(() => fixture.dispose());
  await settle();
  const { state, opened } = fixture;
  state.openGrant({ preventDefault() { assert.fail('eligible'); } });
  const [type, params] = opened[0];
  assert.equal(type, 'autocompound');
  assert.deepEqual(plain(params), {
    expected_chain_id: CHAIN, validator_address: VALIDATOR, operator_address: BOT, operator_name: 'Alpha',
    existing_grant: true, intent: 'change', validator_name: 'Alpha', schedule: 'every hour',
    stake_amount: '9007199254740993', apr: '0.729787', rewards_amount: '1000000000000000000',
    minimum_reward: '1000000000000000000', unbonding_seconds: '1814400',
    current_expiration: FUTURE, current_cap: '1000000000000000000',
  });
  // While the dialog the store reports as open is up, a second grant dialog is refused.
  let prevented = false;
  state.openGrant({ preventDefault() { prevented = true; } }, 'renew');
  assert.equal(prevented, true);
  assert.equal(opened.length, 1);
  fixture.txDialog.dialogOpen = false;
  state.openGrant({ preventDefault() { assert.fail('eligible'); } }, 'renew');
  assert.equal(opened[1][1].intent, 'renew');
  fixture.txDialog.dialogOpen = false;
  state.openRevoke(state.relevantGrants.value[0], { preventDefault() { assert.fail('revocable'); } });
  assert.deepEqual(plain(opened[2][1]), { expected_chain_id: CHAIN, operator_address: BOT, operator_name: 'Alpha', message_type: DELEGATE, validator_name: 'Alpha' });

  const unlimited = grant(); delete unlimited.authorization.max_tokens;
  const broad = componentFixture({ grants: { grants: [unlimited] } });
  t.after(() => broad.dispose());
  await settle();
  broad.state.openGrant({ preventDefault() { assert.fail('eligible'); } });
  assert.equal(broad.opened[0][1].current_cap_unlimited, true);
  assert.equal('current_cap' in broad.opened[0][1], false);
  assert.equal(broad.opened[0][1].existing_grant, true);

  const ended = componentFixture({ grants: { grants: [grant({ expiration: '2020-01-01T00:00:00Z' })] } });
  t.after(() => ended.dispose());
  await settle();
  ended.state.openGrant({ preventDefault() { assert.fail('eligible'); } });
  assert.equal(ended.opened[0][1].existing_grant, false);
  assert.equal(ended.opened[0][1].intent, 'turn_on');
  assert.equal(ended.opened[0][1].current_expiration, '2020-01-01T00:00:00Z');
});

test('row actions check first, open once and are cancelled by a revoke on another row', async t => {
  const pending = deferred();
  const other = grant({ grantee: OTHER_BOT }); other.authorization.allow_list = { address: [OTHER_VALIDATOR] };
  const fixture = componentFixture({ directory: new Error('HTTP 403'), grants: { grants: [grant(), other] },
    raw: async (url, value) => { if (url.includes('/Alpha/')) await pending.promise; return value; } });
  t.after(() => fixture.dispose());
  await settle();
  const { state, opened, txDialog } = fixture;
  assert.equal(state.selected.value, VALIDATOR);
  const run = state.runAction(VALIDATOR, 'turn_on');
  await settle();
  assert.equal(state.pendingAction.value.phase, 'checking');
  assert.equal(state.isChecking(state.rows.value[0]), true);
  assert.equal(state.actionDisabled(state.rows.value[1]), true);
  assert.equal(opened.length, 0);
  const grantB = state.relevantGrants.value.find(item => item.grantee === OTHER_BOT);
  state.openRevoke(grantB, { preventDefault() { assert.fail('Turn off stays available during a check'); } });
  assert.equal(state.pendingAction.value, null);
  pending.resolve();
  await run;
  await settle();
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'autocompound_revoke');
  assert.equal(opened[0][1].operator_address, OTHER_BOT);

  // A fresh action on the now-verified row opens the grant dialog once, and a
  // second row cannot open another dialog while that one is open.
  txDialog.dialogOpen = false;
  await state.runAction(VALIDATOR, 'raise_limit');
  assert.equal(opened.length, 2);
  assert.equal(opened[1][0], 'autocompound');
  assert.equal(opened[1][1].intent, 'raise_limit');
  assert.equal(state.pendingAction.value.phase, 'dialog_open');
  await state.runAction(OTHER_VALIDATOR, 'turn_on');
  assert.equal(opened.length, 2);
  assert.equal(state.pendingAction.value.phase, 'blocked');
  assert.equal(state.pendingAction.value.blocker, 'dialog');
});

test('a failed check surfaces the blocker under the row in plain words with its repair action', async t => {
  const fixture = componentFixture({ rewards: new Error('offline') });
  t.after(() => fixture.dispose());
  await settle();
  const { state, opened } = fixture;
  await state.runAction(VALIDATOR, 'turn_on');
  assert.equal(opened.length, 0);
  assert.equal(state.pendingAction.value.phase, 'blocked');
  const blocker = state.blockerFor(state.rows.value[0]);
  assert.equal(blocker.text, "Couldn't load your rewards, so auto-compound can't be turned on right now. You can still turn it off.");
  assert.equal(blocker.button.label, 'Try again');
  assert.equal(state.blockerFor(state.rows.value[1]), null);
  assert.doesNotMatch(state.grantBlocker.value, FORBIDDEN);

  const elsewhere = componentFixture({ withdraw: { withdraw_address: OTHER_BOT } });
  t.after(() => elsewhere.dispose());
  await settle();
  assert.match(elsewhere.state.grantBlocker.value, /^Your rewards go to epix1/);
  assert.match(elsewhere.state.withdrawNotice.value, /epixd tx distribution set-withdraw-addr/);
  let prevented = false;
  elsewhere.state.openGrant({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);

  // A validator query that failed is "couldn't check", never "jailed or inactive",
  // and the row action re-runs the query on Try again instead of repeating the verdict.
  let validatorCalls = 0;
  const unanswered = componentFixture({ validator: () => { validatorCalls += 1; return new Error('offline'); } });
  t.after(() => unanswered.dispose());
  await settle();
  assert.equal(unanswered.state.validatorActive.value, null);
  assert.ok(unanswered.state.operatorError.value);
  const before = validatorCalls;
  await unanswered.state.runAction(VALIDATOR, 'turn_on');
  await settle();
  assert.equal(unanswered.opened.length, 0);
  assert.equal(unanswered.state.pendingAction.value.phase, 'blocked');
  assert.equal(unanswered.state.pendingAction.value.blocker, 'unchecked');
  const unchecked = unanswered.state.blockerFor(unanswered.state.rows.value[0]);
  assert.equal(unchecked.text, "Couldn't check Alpha right now.");
  assert.equal(unchecked.button.label, 'Try again');
  assert.ok(validatorCalls > before);
});

test('the summary never claims off or none while the service list is loading or unknown', async t => {
  const pending = deferred();
  const fixture = componentFixture({ snapshot: new Error('no bundle'), grants: { grants: [] },
    directory: async () => { await pending.promise; return new Error('down'); } });
  t.after(() => fixture.dispose());
  await settle();
  const { state } = fixture;
  assert.equal(state.rows.value.length, 2);
  assert.equal(state.registryState.value, 'loading');
  assert.equal(state.summary.value, '');
  assert.equal(state.statusText.value, '');
  pending.resolve();
  await settle();
  assert.equal(state.registryState.value, 'unavailable');
  assert.equal(state.summary.value, "Couldn't check which of your 2 validators offer auto-compound.");
  assert.equal(state.statusText.value, "Loaded. Couldn't check which of your 2 validators offer auto-compound.");
});

test('submitted and confirmed callbacks drive the pending row and the confirmation caption', async t => {
  const fixture = componentFixture();
  t.after(() => fixture.dispose());
  await settle();
  const { state, opened } = fixture;
  state.openGrant({ preventDefault() { assert.fail('eligible'); } }, 'raise_limit');
  const callback = opened[0][2];
  callback({ phase: 'submitted', hash: 'C'.repeat(64), eventType: 'autocompound' });
  await settle();
  assert.equal(state.rows.value[0].status.kind, 'pending');
  assert.equal(state.rows.value[0].status.primary.action, 'check_status');
  assert.equal(state.rows.value[0].pending.hash, 'C'.repeat(64));
  assert.equal(state.rows.value[1].status.kind, 'off');
  callback({ phase: 'confirmed', hash: 'C'.repeat(64), eventType: 'autocompound' });
  await settle();
  assert.equal(state.rows.value[0].status.kind, 'not_running');
  assert.equal(state.rowCaption(state.rows.value[0]), 'Limit raised just now');
  assert.equal(state.highlighted(state.rows.value[0]), true);
  assert.equal(Object.keys(state.pendingRows.value).length, 0);

  // A confirmed turn-on regroups the row at once: the grant appears with the
  // confirmed callback's reload, and the row leaves "Ready to turn on".
  let landed = false;
  const fresh = componentFixture({ grants: (_url, value) => (landed ? value : { grants: [] }) });
  t.after(() => fresh.dispose());
  await settle();
  assert.deepEqual(plain(fresh.state.sections.value.map(section => [section.key, section.rows.length])), [['ready', 2]]);
  fresh.state.openGrant({ preventDefault() { assert.fail('eligible'); } }, 'turn_on');
  const confirm = fresh.opened[0][2];
  confirm({ phase: 'submitted', hash: 'D'.repeat(64), eventType: 'autocompound' });
  await settle();
  assert.equal(fresh.state.rows.value[0].status.kind, 'pending');
  assert.deepEqual(plain(fresh.state.sections.value.map(section => [section.key, section.rows.length])), [['ready', 2]]);
  landed = true;
  confirm({ phase: 'confirmed', hash: 'D'.repeat(64), eventType: 'autocompound' });
  await settle();
  assert.equal(fresh.state.rows.value[0].status.kind, 'not_running');
  assert.equal(fresh.state.rowCaption(fresh.state.rows.value[0]), 'Turned on just now');
  assert.deepEqual(plain(fresh.state.sections.value.map(section => [section.key, section.rows.length])), [['attention', 1], ['ready', 1]]);
  assert.deepEqual(plain(fresh.state.chips.value.map(chipText)), ['All', 'Needs attention 1', 'Ready 1']);
  assert.equal(fresh.state.summary.value, '1 of your 2 validators is on but needs attention.');
  assert.equal(Object.keys(fresh.state.pendingRows.value).length, 0);
});

test('a stored pending authorization marks its row as confirming after a reload', async t => {
  const entries = {};
  const localStorage = { getItem: key => Object.hasOwn(entries, key) ? entries[key] : null, setItem(key, value) { entries[key] = value; }, removeItem(key) { delete entries[key]; } };
  const api = load();
  // Alpha's record describes a grant that is already on chain (the fixture grant), so it is
  // settled, not pending; Beta's record has no grant yet and is pending; a malformed record is ignored.
  entries[api.pendingAuthorizationKey(CHAIN, OWNER, BOT, DELEGATE)] =
    JSON.stringify({ hash: 'D'.repeat(64), action: 'autocompound', createdAt: 1, timeoutHeight: '200' });
  entries[api.pendingAuthorizationKey(CHAIN, OWNER, OTHER_BOT, DELEGATE)] =
    JSON.stringify({ hash: 'E'.repeat(64), action: 'autocompound', createdAt: 1, timeoutHeight: '200' });
  entries[api.pendingAuthorizationKey(CHAIN, OWNER, OTHER_BOT, WITHDRAW)] = 'malformed';
  const fixture = componentFixture({}, { globals: { localStorage } });
  t.after(() => fixture.dispose());
  await settle();
  const { state } = fixture;
  assert.equal(state.rows.value[0].status.kind, 'not_running');
  assert.equal(state.rows.value[0].pending, null);
  assert.equal(state.rows.value[1].status.kind, 'pending');
  assert.equal(state.rows.value[1].pending.hash, 'E'.repeat(64));
  assert.equal(state.rows.value[1].pending.stored, true);
  // A refresh with the record still in storage does not duplicate or resurrect anything.
  await state.refreshAccount();
  await settle();
  assert.equal(state.rows.value[0].pending, null);
  assert.equal(state.rows.value[1].status.kind, 'pending');
  // The last seen end date is remembered per viewer (A27).
  assert.equal(entries['epix:autocompound-last-end:' + JSON.stringify([CHAIN, OWNER, BOT])], FUTURE);

  // A record whose timeout height the chain has already passed (the account
  // loads at height 100) can no longer land: it is not pending, so a grant
  // that has since ended never comes back as "Confirming…" just because the
  // widget left its record behind.
  const stale = {};
  stale[api.pendingAuthorizationKey(CHAIN, OWNER, OTHER_BOT, DELEGATE)] =
    JSON.stringify({ hash: 'E'.repeat(64), action: 'autocompound', createdAt: 1, timeoutHeight: '100' });
  const staleStore = { getItem: key => Object.hasOwn(stale, key) ? stale[key] : null, setItem(key, value) { stale[key] = value; }, removeItem(key) { delete stale[key]; } };
  const timedOut = componentFixture({}, { globals: { localStorage: staleStore } });
  t.after(() => timedOut.dispose());
  await settle();
  assert.equal(timedOut.state.rows.value[1].status.kind, 'off');
  assert.equal(timedOut.state.rows.value[1].pending, null);

  // A turn-off that is only reconciled on reload (its grant is already gone)
  // forgets the remembered end date exactly like one the page watched settle.
  const forgotten = {};
  const endKey = 'epix:autocompound-last-end:' + JSON.stringify([CHAIN, OWNER, BOT]);
  forgotten[endKey] = '2020-01-01T00:00:00Z';
  forgotten[api.pendingAuthorizationKey(CHAIN, OWNER, BOT, DELEGATE)] =
    JSON.stringify({ hash: 'F'.repeat(64), action: 'autocompound_revoke', createdAt: 1, timeoutHeight: '200' });
  const forgetStore = { getItem: key => Object.hasOwn(forgotten, key) ? forgotten[key] : null, setItem(key, value) { forgotten[key] = value; }, removeItem(key) { delete forgotten[key]; } };
  const reconciled = componentFixture({ grants: { grants: [] } }, { globals: { localStorage: forgetStore } });
  t.after(() => reconciled.dispose());
  await settle();
  assert.equal(reconciled.state.rows.value[0].status.kind, 'off');
  assert.equal(reconciled.state.rows.value[0].pending, null);
  assert.equal(reconciled.state.rows.value[0].status.primary.label, 'Turn on');
  assert.equal(Object.hasOwn(forgotten, endKey), false);
});

test('pending rows poll the account until the change is visible, then settle with a caption', async t => {
  const queue = [];
  let grantCalls = 0;
  // The grant appears only on the second account load, i.e. after the transaction.
  const fixture = componentFixture({ grants: (_url, value) => (++grantCalls > 1 ? value : { grants: [] }) },
    { globals: { setTimeout: callback => { queue.push(callback); return queue.length; }, clearTimeout() {} } });
  t.after(() => fixture.dispose());
  await settle();
  const { state, opened } = fixture;
  assert.equal(state.rows.value[0].status.kind, 'off');
  state.openGrant({ preventDefault() { assert.fail('eligible'); } }, 'turn_on');
  opened[0][2]({ phase: 'submitted', hash: 'F'.repeat(64), eventType: 'autocompound' });
  await settle();
  assert.equal(state.rows.value[0].status.kind, 'pending');
  assert.deepEqual(plain(state.sections.value.map(section => section.key)), ['ready']);
  const scheduled = queue.length;
  assert.ok(scheduled >= 1);
  // Drain the fake timers: the poll reloads the account, sees the live grant and settles.
  while (queue.length) {
    queue.shift()();
    await settle();
  }
  assert.ok(grantCalls >= 2);
  assert.equal(state.rows.value[0].status.kind, 'not_running');
  assert.equal(state.rows.value[0].pending, null);
  assert.equal(state.rowCaption(state.rows.value[0]), 'Turned on just now');
  assert.equal(state.highlighted(state.rows.value[0]), true);
  assert.equal(Object.keys(state.pendingRows.value).length, 0);

  // Switching wallets leaves nothing of the previous account's pending or caption state behind.
  fixture.txDialog.dialogOpen = false;
  state.openGrant({ preventDefault() { assert.fail('eligible'); } }, 'renew');
  opened.at(-1)[2]({ phase: 'submitted', hash: 'A'.repeat(64), eventType: 'autocompound' });
  await settle();
  assert.equal(Object.keys(state.pendingRows.value).length, 1);
  fixture.wallet.currentAddress = address('epix', 7);
  await settle();
  assert.equal(Object.keys(state.pendingRows.value).length, 0);
  assert.equal(state.rowCaption(state.rows.value[0]), '');
  assert.equal(state.highlighted(state.rows.value[0]), false);
});

test('a Refresh settles a pending row whose polls ran out once the change is visible', async t => {
  const queue = [];
  let landed = false;
  const fixture = componentFixture({ grants: (_url, value) => (landed ? value : { grants: [] }) },
    { globals: { setTimeout: callback => { queue.push(callback); return queue.length; }, clearTimeout() {} } });
  t.after(() => fixture.dispose());
  await settle();
  const { state, opened } = fixture;
  state.openGrant({ preventDefault() { assert.fail('eligible'); } }, 'turn_on');
  opened[0][2]({ phase: 'submitted', hash: 'G'.repeat(64), eventType: 'autocompound' });
  await settle();
  // Five polls without the grant: the row stays pending and stops polling.
  while (queue.length && !state.rows.value[0].pending?.exhausted) {
    queue.shift()();
    await settle();
  }
  assert.equal(state.rows.value[0].status.kind, 'pending');
  assert.equal(state.rows.value[0].pending.exhausted, true);
  assert.equal(state.rows.value[0].pending.polls, 5);
  assert.deepEqual(plain(state.sections.value.map(section => section.key)), ['ready']);
  // [Refresh] reloads the account; the grant is there now, so the row settles
  // with its caption and regroups without a poll of its own.
  landed = true;
  await state.refreshAccount();
  await settle();
  assert.equal(state.rows.value[0].status.kind, 'not_running');
  assert.equal(state.rows.value[0].pending, null);
  assert.equal(state.rowCaption(state.rows.value[0]), 'Turned on just now');
  assert.equal(Object.keys(state.pendingRows.value).length, 0);
  assert.deepEqual(plain(state.sections.value.map(section => section.key)), ['attention', 'ready']);
});

test('the not-offered group is plainly titled once every row was checked and folds away while something is on or ready', async t => {
  const THIRD = address('epixvaloper', 6);
  const reward = validator_address => ({ validator_address, reward: [{ denom: 'aepix', amount: '1000000000000000000.5' }] });
  const fixture = componentFixture({
    delegations: { delegation_responses: [delegation(), delegation(OTHER_VALIDATOR), delegation(THIRD)] },
    rewards: { rewards: [VALIDATOR, OTHER_VALIDATOR, THIRD].map(reward) },
  });
  t.after(() => fixture.dispose());
  await settle();
  const { state } = fixture;
  const other = () => state.sections.value.find(section => section.key === 'other');
  assert.deepEqual(plain(state.rows.value.map(row => row.status.kind)), ['not_running', 'off', 'not_offered']);
  assert.equal(state.rows.value[2].status.text, "Doesn't run an auto-compound service.");
  assert.equal(other().title, 'Not offered');
  assert.equal(other().total, 1);
  assert.deepEqual(plain(state.chips.value.map(chipText)), ['All', 'Needs attention 1', 'Ready 1', 'Not offered 1']);
  // Moving stake is an option, never the call to action; the offers action is a link.
  const move = state.buttonClass(state.rows.value[2].status.primary, true);
  assert.equal(move.includes('ac-btn-primary'), false);
  assert.equal(move.includes('ac-btn-quiet'), true);
  assert.equal(state.buttonClass(state.rows.value[2].status.secondary[0], false).includes('text-epix-teal'), true);
  // Something is on or ready, so the group starts folded; the chip opens it
  // and "All" folds it again.
  assert.equal(state.otherOpen.value, false);
  state.selectFilter('other');
  await settle();
  assert.equal(state.otherOpen.value, true);
  assert.deepEqual(plain(state.sections.value.map(section => section.key)), ['other']);
  state.selectFilter('all');
  await settle();
  assert.equal(state.otherOpen.value, false);

  // Nothing on or ready: the group is open from the start. With the service
  // list unavailable the row could not be checked, so the title still hedges.
  const unknown = componentFixture({ snapshot: new Error('no bundle'), directory: new Error('down'), grants: { grants: [] },
    delegations: { delegation_responses: [delegation(THIRD)] }, rewards: { rewards: [reward(THIRD)] } });
  t.after(() => unknown.dispose());
  await settle();
  assert.equal(unknown.state.rows.value[0].status.kind, 'unknown');
  assert.equal(unknown.state.sections.value.find(section => section.key === 'other').title, "Not offered or couldn't check");
  assert.equal(unknown.state.otherOpen.value, true);
});

test('focused validator: staked, listed but unstaked, unlisted and invalid links', async t => {
  const staked = componentFixture({}, { query: { validator: VALIDATOR } });
  t.after(() => staked.dispose());
  await settle();
  assert.equal(staked.state.pinnedRow.value.validator, VALIDATOR);
  assert.equal(staked.state.focused.value.kind, 'row');
  assert.equal(staked.state.selected.value, VALIDATOR);
  assert.equal(staked.state.detailsOpen.value[VALIDATOR], true);
  assert.equal(staked.state.rowCaption(staked.state.pinnedRow.value), "From Alpha's page");
  assert.deepEqual(plain(staked.state.sections.value.map(section => section.key)), ['ready']);

  const listed = componentFixture({ delegations: { delegation_responses: [delegation(VALIDATOR)] } }, { query: { validator: OTHER_VALIDATOR } });
  t.after(() => listed.dispose());
  await settle();
  assert.equal(listed.state.focused.value.kind, 'stake');
  assert.equal(listed.state.focused.value.name, 'Beta');
  assert.equal(listed.state.selected.value, VALIDATOR);
  listed.state.openDelegate(OTHER_VALIDATOR);
  assert.deepEqual(plain(listed.opened[0].slice(0, 2)), ['delegate', { validator_address: OTHER_VALIDATOR }]);

  const unlisted = componentFixture({}, { query: { validator: address('epixvaloper', 9) } });
  t.after(() => unlisted.dispose());
  await settle();
  assert.equal(unlisted.state.focused.value.kind, 'not_listed');
  assert.equal(unlisted.state.offersOpen.value, true);

  const invalid = componentFixture({}, { query: { validator: 'nope' } });
  t.after(() => invalid.dispose());
  await settle();
  assert.equal(invalid.state.focusedQuery.value, '');
  assert.equal(invalid.state.focused.value, null);
  assert.equal(invalid.state.pinnedRow.value, null);
});

test('refresh keeps the previous account on screen and a connected wallet drops its own account query', async t => {
  const pending = deferred();
  let count = 0;
  const fixture = componentFixture({ grants: async (_url, value) => { if (++count > 1) await pending.promise; return value; } });
  t.after(() => fixture.dispose());
  await settle();
  const { state } = fixture;
  assert.ok(state.account.value);
  const refresh = state.refreshAccount();
  assert.equal(state.accountLoading.value, true);
  assert.equal(state.accountStale.value, true);
  assert.equal(state.account.value.grants.length, 1);
  assert.equal(state.rows.value.length, 2);
  assert.ok(state.grantBlocker.value);
  pending.resolve();
  await refresh;
  await settle();
  assert.equal(state.accountStale.value, false);
  assert.equal(state.accountLoading.value, false);

  const own = componentFixture({}, { query: { account: OWNER } });
  t.after(() => own.dispose());
  await settle();
  assert.equal(own.replaced.length, 1);
  assert.equal(own.replaced[0].query.account, undefined);
  assert.equal(own.state.canManage.value, true);

  const noRouter = componentFixture({}, { query: { account: OWNER }, router: false });
  t.after(() => noRouter.dispose());
  await settle();
  assert.equal(noRouter.state.canManage.value, true);
  assert.equal(noRouter.state.rows.value.length, 2);
});

test('an unsupported wallet keeps rows visible but hides every action, and store monikers are optional', async t => {
  const stakingStore = vue.reactive({ validators: [{ operator_address: VALIDATOR, jailed: false, status: 'BOND_STATUS_BONDED',
    description: { moniker: 'Alpha Node', identity: 'ABC' }, commission: { commission_rates: { rate: '0.500000000000000000' } }, tokens: epix(5) }] });
  const fixture = componentFixture({}, { staking: stakingStore });
  t.after(() => fixture.dispose());
  await settle();
  const { state, wallet } = fixture;
  assert.equal(state.rows.value[0].name, 'Alpha Node');
  assert.equal(state.rows.value[0].apr, '0.364893');
  assert.equal(state.rows.value[1].name, 'Beta');
  assert.equal(state.actionsAllowed.value, true);
  wallet.connectedWallet = { wallet: 'Metamask' };
  await settle();
  assert.equal(state.walletSupported.value, false);
  assert.equal(state.actionsAllowed.value, false);
  assert.equal(state.canManage.value, true);
  assert.equal(state.rows.value.length, 2);
  wallet.connectedWallet = { wallet: 'Keplr' };
  await settle();
  assert.equal(state.actionsAllowed.value, true);
});

// ---------------------------------------------------------------------------
// Component: last re-stake of every listed service (A16, extended to every card)
// ---------------------------------------------------------------------------
function activityTx(grantee, delegator, validator, timestamp, hash = 'B'.repeat(64), code = '0') {
  return {
    tx: { body: { messages: [{ '@type': '/cosmos.authz.v1beta1.MsgExec', grantee,
      msgs: [{ '@type': DELEGATE, delegator_address: delegator, validator_address: validator }] }] } },
    response: { code, txhash: hash, timestamp },
  };
}

function activityPage(...items) {
  return { txs: items.map(item => item.tx), tx_responses: items.map(item => item.response) };
}

const txQueries = (calls, grantee = '') => calls.filter(call => call.url.includes('/cosmos/tx/v1beta1/txs') && call.url.includes(grantee));

test('component checks every listed service once, at most four at a time, and shows the verdict on each offer', async t => {
  const listed = Array.from({ length: 6 }, (_, index) => operator({
    address: address('epixvaloper', 10 + index), name: 'Service ' + index,
    restake: { ...operator().restake, address: address('epix', 20 + index) },
  }));
  const gate = deferred();
  let waiting = 0, peak = 0;
  const fixture = componentFixture({
    directory: { name: 'epix', validators: listed },
    activity: async (url, value) => {
      waiting += 1;
      peak = Math.max(peak, waiting);
      await gate.promise;
      waiting -= 1;
      // Service 0 re-staked for another account an hour ago; the others never sent anything.
      return url.includes(address('epix', 20))
        ? activityPage(activityTx(address('epix', 20), OTHER_BOT, address('epixvaloper', 10), new Date(fixture.state.now.value - 90 * 60000).toISOString()))
        : value;
    },
  });
  t.after(() => fixture.dispose());
  await settle();
  const { state, calls } = fixture;
  assert.equal(state.offers.value.length, 6);
  assert.equal(peak, 4);
  assert.equal(txQueries(calls).length, 4);
  assert.ok(state.offers.value.every(offer => offer.health.phase === 'loading' && offer.health.short === 'Checking…' && offer.health.tone === 'gray'));
  gate.resolve();
  await settle();
  assert.equal(peak, 4);
  assert.equal(txQueries(calls).length, 6);
  const senders = txQueries(calls).map(call => new URL(call.url).searchParams.get('query'));
  assert.deepEqual(plain([...new Set(senders)].sort()), listed.map(item => "message.sender='" + item.restake.address + "'").sort());
  assert.ok(txQueries(calls).every(call => new URL(call.url).searchParams.get('pagination.limit') === '10'));
  const first = state.offers.value.find(offer => offer.name === 'Service 0');
  assert.deepEqual([first.health.phase, first.health.tone, first.health.icon, first.health.short], ['recent', 'green', 'mdi:check-circle', 'Last re-stake 1 h ago']);
  assert.equal(first.health.activity.delegator, OTHER_BOT);
  const rest = state.offers.value.filter(offer => offer.name !== 'Service 0');
  assert.equal(rest.length, 5);
  assert.ok(rest.every(offer => offer.health.phase === 'silent' && offer.health.short === 'No recent re-stake' && offer.health.tone === 'amber'));
  assert.ok(rest.every(offer => offer.health.icon === 'mdi:alert-circle-outline' && offer.health.text === "This service hasn't sent any transactions yet. It may not be running."));
  // Filter chips, the search box and the clock never re-query.
  state.selectFilter('on');
  state.search.value = 'Service 3';
  state.now.value = Date.now() + 1000;
  await settle();
  state.selectFilter('all');
  await settle();
  assert.equal(txQueries(calls).length, 6);
  assert.equal(state.filter.value, 'all');
});

test('a late answer from an aborted service check never lands, a refresh reuses fresh answers, and unmount aborts', async t => {
  const late = deferred();
  let alphaCalls = 0;
  const fixture = componentFixture({ activity: async (url, value) => {
    if (!url.includes(BOT)) return value;
    if (++alphaCalls === 1) {
      await late.promise;
      return activityPage(activityTx(BOT, OWNER, VALIDATOR, new Date(fixture.state.now.value - 60000).toISOString()));
    }
    return value;
  } });
  t.after(() => fixture.dispose());
  await settle();
  const { state, calls } = fixture;
  assert.equal(txQueries(calls).length, 2);
  assert.equal(state.activityMap.value[BOT].state, 'loading');
  assert.equal(state.activityMap.value[OTHER_BOT].state, 'done');
  assert.equal(state.rows.value[0].health.phase, 'loading');
  await state.refreshRegistry();
  await settle();
  // Alpha was asked again (the refresh orphaned its first answer); Beta's answer is under five minutes old and reused.
  assert.equal(alphaCalls, 2);
  assert.equal(txQueries(calls).length, 3);
  assert.equal(txQueries(calls, OTHER_BOT).length, 1);
  assert.equal(state.activityMap.value[BOT].state, 'done');
  assert.equal(state.activityMap.value[BOT].txCount, 0);
  late.resolve();
  await settle();
  assert.equal(state.activityMap.value[BOT].txCount, 0);
  assert.equal(state.activityMap.value[BOT].activity, null);
  assert.equal(state.rows.value[0].health.phase, 'silent');
  assert.equal(state.activityText(state.rows.value[0]), "This service hasn't sent any transactions yet.");

  const pending = deferred();
  const gone = componentFixture({ activity: async (_url, value) => { await pending.promise; return value; } });
  await settle();
  assert.equal(gone.state.activityMap.value[BOT].state, 'loading');
  gone.dispose();
  pending.resolve();
  await settle();
  assert.equal(gone.state.activityMap.value[BOT].state, 'loading');
});

test('a healthy row is flagged only once its service is seen silent or stale, and a re-check goes through the same map', async t => {
  const answers = [];
  const gate = deferred();
  answers.push(async () => { await gate.promise; return null; });
  const fixture = componentFixture({
    grants: { grants: [grant({ authorization: { ...grant().authorization, max_tokens: { denom: 'aepix', amount: epix(1000) } } })] },
    delegations: { delegation_responses: [delegation(VALIDATOR, epix(1000)), delegation(OTHER_VALIDATOR, epix(1000))] },
    rewards: { rewards: [VALIDATOR, OTHER_VALIDATOR].map(validator_address => ({ validator_address, reward: [{ denom: 'aepix', amount: '100000000000000000' }] })) },
    activity: async (url, value) => {
      if (!url.includes(BOT)) return value;
      const next = answers.shift();
      const answer = typeof next === 'function' ? await next() : next;
      if (answer instanceof Error) throw answer;
      return answer || value;
    },
  });
  t.after(() => fixture.dispose());
  await settle();
  const { state, calls } = fixture;
  const alpha = () => state.rows.value[0];
  // Still checking: plain On, grouped as on, not flagged.
  assert.equal(alpha().name, 'Alpha');
  assert.equal(alpha().status.kind, 'on');
  assert.equal(alpha().health.phase, 'loading');
  assert.equal(alpha().health.text, "Checking the service's recent re-stakes…");
  assert.equal(state.activityText(alpha()), "Checking the service's recent transactions…");
  assert.deepEqual(plain(state.sections.value.map(section => [section.key, section.rows.length])), [['ready', 1], ['on', 1]]);
  assert.equal(state.summary.value, 'On for 1 of your 2 validators.');
  gate.resolve();
  await settle();
  // No transactions at all: silent, so the row needs attention and the counts follow.
  assert.equal(alpha().status.kind, 'not_running');
  assert.equal(alpha().status.label, 'Not re-staking');
  assert.equal(alpha().status.text, "Permission is on, but this service hasn't re-staked for anyone in its recent transactions. It may not be running.");
  assert.equal(alpha().status.primary.action, 'check_service');
  assert.deepEqual([alpha().health.phase, alpha().health.tone, alpha().health.icon], ['silent', 'amber', 'mdi:alert-circle-outline']);
  assert.equal(alpha().health.text, "This service hasn't sent any transactions yet. It may not be running.");
  assert.equal(state.notRunningBasis(alpha()), "Based on the service's recent transactions.");
  assert.equal(state.activityText(alpha()), "This service hasn't sent any transactions yet.");
  assert.deepEqual(plain(state.sections.value.map(section => [section.key, section.rows.length])), [['attention', 1], ['ready', 1]]);
  assert.deepEqual(plain(state.chips.value.map(chipText)), ['All', 'Needs attention 1', 'Ready 1']);
  assert.equal(state.summary.value, '1 of your 2 validators is on but needs attention.');
  const before = txQueries(calls, BOT).length;

  // [Check service] re-reads the service and finds a run for this account an hour ago: On again.
  answers.push(activityPage(activityTx(BOT, OWNER, VALIDATOR, new Date(state.now.value - 90 * 60000).toISOString())));
  state.act(alpha(), alpha().status.primary, { preventDefault() {} });
  await settle();
  assert.equal(txQueries(calls, BOT).length, before + 1);
  assert.equal(alpha().status.kind, 'on');
  assert.deepEqual([alpha().health.phase, alpha().health.tone, alpha().health.icon], ['recent', 'green', 'mdi:check-circle']);
  assert.equal(alpha().health.text, 'Service last re-staked 1 h ago ✓ (for you)');
  assert.equal(alpha().health.activity.hash, 'B'.repeat(64));
  assert.equal(alpha().health.own, true);
  assert.equal(state.selected.value, VALIDATOR);
  assert.equal(state.activityValidator.value, VALIDATOR);
  assert.equal(state.activityState.value, 'found');
  assert.equal(state.activity.value.hash, 'B'.repeat(64));
  assert.equal(state.activityLoading.value, false);
  assert.equal(state.activityText(alpha()), 'Re-staked your rewards 1 h ago ✓');
  assert.deepEqual(plain(state.sections.value.map(section => section.key)), ['ready', 'on']);

  // Two days without a run on an hourly schedule: stale.
  answers.push(activityPage(activityTx(BOT, OTHER_BOT, VALIDATOR, new Date(state.now.value - 48 * 3600000).toISOString(), 'C'.repeat(64))));
  state.checkActivityFor(VALIDATOR);
  await settle();
  assert.equal(alpha().status.kind, 'not_running');
  assert.equal(alpha().status.text, 'Permission is on, but this service last re-staked for anyone 2 d ago, longer than its schedule (every hour) allows. It may not be running.');
  assert.equal(alpha().health.phase, 'stale');
  assert.equal(alpha().health.text, 'Service last re-staked 2 d ago, longer than its schedule (every hour) allows. It may not be running.');
  assert.equal(alpha().health.activity.hash, 'C'.repeat(64));
  assert.equal(alpha().health.own, false);
  assert.equal(state.activityText(alpha()), 'Last re-stake 2 d ago, for another account, longer than its schedule (every hour) allows.');
  assert.deepEqual(plain(state.sections.value.map(section => section.key)), ['attention', 'ready']);

  // A re-check in progress keeps the verdict; a failed check judges nothing.
  const slow = deferred();
  answers.push(async () => { await slow.promise; return new Error('HTTP 429'); });
  state.checkActivityFor(VALIDATOR);
  await settle();
  assert.equal(alpha().health.phase, 'loading');
  assert.equal(alpha().status.kind, 'not_running');
  assert.equal(state.activityLoading.value, true);
  slow.resolve();
  await settle();
  assert.equal(alpha().health.phase, 'unavailable');
  assert.equal(alpha().health.text, "Couldn't check recent re-stakes.");
  assert.equal(alpha().health.tone, 'gray');
  assert.equal(alpha().status.kind, 'on');
  assert.equal(state.activityState.value, 'unavailable');
  assert.equal(state.activityText(alpha()), "Couldn't check recent activity.");
  assert.deepEqual(plain(state.sections.value.map(section => section.key)), ['ready', 'on']);

  // Transactions without a re-stake to this validator: silent, naming how many were read.
  answers.push(activityPage(activityTx(BOT, OWNER, OTHER_VALIDATOR, new Date(state.now.value - 60000).toISOString(), 'D'.repeat(64))));
  state.checkActivity(alpha().operator, true);
  await settle();
  assert.equal(alpha().health.phase, 'silent');
  assert.equal(alpha().health.text, "No re-stake in this service's last 1 transaction. It may not be running.");
  assert.equal(state.activityText(alpha()), "No re-stake in this service's last 1 transaction. That can be normal if nobody's rewards reached the minimum yet.");
  assert.equal(alpha().status.kind, 'not_running');
  assert.equal(state.activityMap.value[BOT].txCount, 1);
});

test('service indicator maps every activity state to running, not running or offered', () => {
  const api = load();
  const op = api.parseOperator(operator(), 'fixture');
  const now = Date.parse('2040-01-01T12:00:00Z');
  assert.equal(api.serviceIndicator(op, undefined, now).kind, 'offered');
  assert.match(api.serviceIndicator(op, undefined, now).title, /Checking recent activity/);
  assert.equal(api.serviceIndicator(op, { state: 'loading', lastRun: null, txCount: null }, now).kind, 'offered');
  const unknown = api.serviceIndicator(op, { state: 'unknown', lastRun: null, txCount: null }, now);
  assert.equal(unknown.kind, 'offered');
  assert.match(unknown.title, /Couldn't check/);
  const running = api.serviceIndicator(op, { state: 'recent', lastRun: '2040-01-01T11:56:00Z', txCount: 10 }, now);
  assert.equal(running.kind, 'running');
  assert.match(running.title, /last re-stake 4 min ago/);
  const stale = api.serviceIndicator(op, { state: 'stale', lastRun: '2039-12-25T11:56:00Z', txCount: 10 }, now);
  assert.equal(stale.kind, 'not_running');
  assert.match(stale.title, /longer than its schedule/);
  assert.match(api.serviceIndicator(op, { state: 'silent', lastRun: null, txCount: 0 }, now).title, /has not sent any transactions/);
  const silent = api.serviceIndicator(op, { state: 'silent', lastRun: null, txCount: 5 }, now);
  assert.equal(silent.kind, 'not_running');
  assert.match(silent.title, /last 5 transactions/);
});

test('operator list prefers the live directory and falls back to the bundled snapshot', async () => {
  const bundled = { revision: 'b'.repeat(40), entries: [{ name: 'Bundled', path: 'Bundled/chains.json', chain: { ...operator(), name: 'epix' } }] };
  const live = { name: 'epix', validators: [operator({ name: 'Live' }), operator({ address: OTHER_VALIDATOR, name: 'Other', restake: { ...operator().restake, address: OTHER_BOT } })] };
  const make = (directory) => load(async url => {
    if (url.endsWith('/autocompound/operators.json')) return new Response(JSON.stringify(bundled));
    if (directory instanceof Error) throw directory;
    return new Response(JSON.stringify(directory));
  });
  const fromDirectory = await make(live).loadOperatorList('https://dashboard.epix/index.html');
  assert.equal(fromDirectory.source, 'directory');
  assert.deepEqual(plain(fromDirectory.operators.map(item => item.name)), ['Live', 'Other']);
  assert.equal(fromDirectory.operators[0].registryPath, 'Bundled/chains.json');
  const fallback = await make(new Error('offline')).loadOperatorList('https://dashboard.epix/index.html');
  assert.equal(fallback.source, 'bundled');
  assert.deepEqual(plain(fallback.operators.map(item => item.name)), ['Bundled']);
  const broken = load(async () => { throw new Error('offline'); });
  await assert.rejects(broken.loadOperatorList('https://dashboard.epix/index.html'), /offline/);
});
