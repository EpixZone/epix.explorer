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
  for (const token of ['1.0000000000000001', '9007199254740991.1', '1e-999', '1e3', '-0', '1.0']) {
    const raw = JSON.stringify(operator()).replace('"1000000000000000000"', token);
    assert.throws(() => api.parseOperator(api.parseExactJson(raw), 'fixture'), /integer/i, token);
  }
  const exact = JSON.stringify(operator()).replace('"1000000000000000000"', '10000000000000000000001');
  assert.equal(api.parseOperator(api.parseExactJson(exact), 'fixture').minimumReward, '10000000000000000000001');
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
    assert.equal(await api.loadValidator(ENDPOINT, VALIDATOR), expected);
  }
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

function componentFixture(overrides = {}) {
  const first = operator({ name: 'Alpha' });
  const second = operator({ address: OTHER_VALIDATOR, name: 'Beta', restake: { ...operator().restake, address: OTHER_BOT } });
  const calls = [], opened = [], cleanup = [];
  const wallet = vue.reactive({ currentAddress: OWNER });
  const chain = vue.reactive({ current: { chainId: CHAIN }, endpoint: { address: ENDPOINT } });
  const route = vue.reactive({ query: {} });
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
  const customRequire = name => {
    if (name === 'vue') return { ...vue, onBeforeUnmount: callback => cleanup.push(callback) };
    if (name === 'vue-router') return { useRoute: () => route };
    if (name === '@/libs/autocompound') return api;
    if (name === '@/stores') return {
      useWalletStore: () => wallet, useBlockchain: () => chain,
      useTxDialog: () => ({ open: (...args) => opened.push(args) }),
    };
    return require(name);
  };
  vm.runInNewContext(componentCode, {
    module, exports: module.exports, require: customRequire, AbortController, URL,
    document: { baseURI: 'https://dashboard.epix/index.html#/staking/autocompound' },
    setInterval: () => 1, clearInterval: () => {},
  }, { filename: componentFilename });
  const state = scope.run(() => module.exports.default.setup({}, { expose() {} }));
  return { state, wallet, chain, route, calls, opened,
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
  assert.match(fixture.state.grantBlocker.value, /Refresh/);
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
