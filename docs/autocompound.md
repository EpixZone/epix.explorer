# Auto-compound

The staking, validator and account pages link to `/staking/autocompound`.
The Explorer discovers validator-operated REStake services and manages their
on-chain permissions. It does not run an operator or require a shared signing key.
The validator's service continues when the browser is closed.

The UI adapts the open-source REStake discovery, grant, status and revoke flows.
The source revision and MIT notice are in `THIRD_PARTY_NOTICES/REStake-UI.txt`.

New Epix accounts can have account numbers above JavaScript's exact integer
range and above the signed 64-bit range. Compatible wallets and validator
runners must preserve unsigned 64-bit values through signing. The maintained
runner changes are in `EpixZone/restake`; validators deploy them in their
existing services. An Explorer update does not update a validator's runner.

## Authorization

A new grant permits only delegation to the selected validator, with a positive
cumulative allowance in `aepix` and a finite expiration. The operator pays the
fees for its scheduled `MsgExec` transactions. The connected account pays for
grant creation and revocation.

The chain enforces the validator, allowance and expiration. It does not enforce
reward-only spending: the operator can delegate available liquid funds within
that allowance. Reward-only execution is the validator runner's policy.

Replacing a grant resets its remaining cumulative allowance. It is not an
increment to the old allowance. Revoking delegation permission stops subsequent
execution under that grant. Closing the Explorer does not pause a service.

Existing grants are loaded independently of registry discovery. Removed or
changed operator addresses remain visible for revocation. Legacy generic
delegation grants are identified as broader permissions. Old reward-withdrawal
permission can be revoked separately; new grants do not request it. Unrelated
authorization types are displayed read only.

The widget rechecks chain identity, staking denomination and the prerequisites
for new grants before signing. Missing delegation or a different reward
withdrawal address prevents enabling a service. These conditions do not prevent
revoking an existing grant.

## Registry and activity

The live operator list comes from `validators.cosmos.directory/chains/epix`,
which publishes `eco-stake/validator-registry` metadata. Public schedules and
minimum rewards describe an operator's advertised service, not its current health.

If the directory is unavailable, the bundled index supplies discovery labels.
The selected entry must then be revalidated directly from its GitHub
`chains.json` before a new grant is offered. Cached metadata does not authorize
a different grantee automatically.

Refresh the bundled index from a reviewed, full Git commit:

```sh
python3 scripts/update-autocompound-registry.py --revision <40-character-commit>
corepack yarn test
```

The updater reads a bounded archive without extracting files. It preserves
integer reward thresholds, validates Epix addresses and records source revision
and archive hash. Review the operator/address diff before committing.

The UI keeps large integers as decimal text. It queries current grants, rewards,
delegations and withdrawal address from the selected chain endpoint. Incomplete
resource queries are marked unavailable rather than displayed as zero.
Existing grants remain revocable when reward or registry queries fail.

Recent activity is a bounded search of the latest 20 operator transactions.
Only committed successful `MsgExec` transactions containing a delegation by the
listed operator to the selected validator count as observed activity. An empty
or unavailable search does not establish that the service never ran.

## Development

Use Node 22.22.1 and the declared Yarn 4.13.0:

```sh
corepack yarn install --immutable
corepack yarn test
corepack yarn build
```

The transaction UI is maintained in `EpixZone/widget`. Build its reviewed
source and vendor the local output before shipping changes to the dialog:

```sh
node scripts/vendor-widget.mjs ../widget/dist
```

Vendoring updates the widget entry hash in `index.html`, so existing clients
load the entry matching the new chunks. Commit the entry and its referenced
chunks together.

The repository's full `type-check` has existing diagnostics outside the
auto-compound changes. CI runs the regression suite, the helper type-check and
the production build. Do not disable strict checks or hide new errors to
accommodate that baseline.
