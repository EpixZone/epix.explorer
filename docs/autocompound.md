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

## The page

The page is organised around the user's own validators rather than the
protocol. It has three states: no wallet and no `?account=` query (connect
card, "How it works" and the list of validators that offer auto-compound are
expanded), viewing another account (`?account=` differs from the connected
wallet: everything renders read-only, every action is hidden) and connected.
Below the `sm` breakpoint the header is one title row with an icon-only
Refresh button and a one-line subtitle that links to "How it works"; the
account's age ("Updated just now") sits in the summary sentence under "Your
validators".

"Your validators" renders one card per delegation. Each card shows the
validator's avatar (keybase picture from the shared `avatars` cache, else a
coloured initial), moniker (deep check, then the staking store, then the
registry name, then the short address), a short bech32-aware address with a
copy button, the staked amount and the rewards waiting (padded to two
decimals so card lines align; Details keeps four), a status badge beside the
name with one line of explanation, the service's threshold line ("Re-stakes once rewards
reach 10 EPIX, about every 5 days at your stake"), the service's last re-stake
("Service last re-staked 2 h ago ✓", see "Registry and activity"), the actions
for that status and a collapsed "Details" disclosure (schedule, service
account, remaining limit, end date in local time and UTC, recent activity,
registry listing).

Cards are grouped as "Needs attention", "Ready to turn on", "On" and
"Not offered" (titled "Not offered or couldn't check" while any row in it could
not be checked), stake-descending inside a group, with one row of filter chips
("All · Needs attention 3 · On 4 · Ready 1 · Not offered 7"; "All" carries no
number because it mixes delegations and permissions). The sentence under "Your
validators" ("On for 4 of your 12 validators (1 more is on but needs
attention).") is derived from the same counts as the chips and the group
headings, so the three never disagree. Groups are captured when account or
registry data arrives or a pending change settles, so a row only moves after a
confirmed change or a Refresh. Live delegate permissions for validators the
account no longer stakes with are listed inside "Needs attention", after its
delegated rows, under the sub-heading "Permissions for validators you no longer
stake with", and count towards that group's heading and chip. "Not offered" is
collapsible: it opens when nothing is on or ready, or when its chip is
selected, and stays folded otherwise; moving stake is explained once above its
rows, and [Move stake] is a quiet option rather than a call to action.

The status badge is derived by `delegationStatus` in `src/libs/autocompound.ts`,
a pure function over the delegation, the registry entry, all delegate grants of
the account, the registry state, the validator's activity, any pending
transaction, the APR estimate and the clock. Status is grant-first: a live
delegate grant that covers the validator means "On" whatever the registry says,
and "Not offered" is only possible once the registry has loaded and no grant
exists. The precedence, first match wins, is: checking, pending, stale
permission (a live grant to an old service account), ended, inactive validator,
limit reached (remaining limit below the larger of the service minimum and the
rewards waiting), not re-staking (rewards waiting well beyond the service's
schedule), won't run (the minimum is further away than the end date), ends soon
(30 days), limit low (less than 30 days of rewards), on (unlisted service), not
re-staking again (a row that would be plain "On" whose service was seen stale
or silent, see below), on, off, couldn't check, not offered. Status copy never
uses the words paused, spending, authorization, grantee or operator.

Only the selected validator is deeply checked (registry entry revalidated,
validator active and unjailed). Other rows derive their status from account and
registry data plus the per-service activity check below; the deep check runs
when the user acts on a row. A row action (Turn on, Renew, Raise limit, Change) selects the validator,
refreshes stale registry metadata, waits for the validator check and then calls
`openGrant`. One action is in flight page-wide; starting another, pressing
Refresh, opening any dialog or a wallet change cancels it. A remaining blocker
is shown under that row with its repair action (Try again, Reload list, Stake,
View validator). Turn off opens the revoke dialog immediately and never waits for
a check.

After a dialog submits, the page marks the row "Confirming…", polls the account
every six seconds up to five times and then shows the row as changed for ten
seconds ("Turned on just now"). The same pending state is detected after a
reload from the widget's local storage entry; the explorer mirrors the key
format in `pendingAuthorizationKey` because it cannot import from the vendored
widget bundle. Refresh keeps the previous account on screen while the new one
loads; the list is never emptied during a refresh. Every account reload,
including Refresh, settles any pending row whose change is now visible, so a
row whose five polls ran out is not stuck, and a settled change regroups its
row at once. A stored widget record whose timeout height the loaded account
has already passed is ignored (that transaction can no longer be included), and
a turn-off found already reconciled on reload forgets the remembered end date
just like one the page watched settle.

`?validator=<valoper>` pins that validator's card to the top (under a
visually hidden heading, with a gray "From {name}'s page" eyebrow and a teal
outline) and preselects it.
If the account has not staked with it, the page explains that and offers the
stake dialog; if it does not run a service, it points to the list of validators
that do. Invalid values are ignored.

Only Keplr, Leap and the Epix MetaMask Snap can sign these transactions. With
any other wallet the page keeps rows and statuses visible, shows a notice and
hides every action, including Turn off, which the widget would reject as well.

## Authorization

A new grant permits only delegation to the selected validator, with a positive
cumulative limit in `aepix` and a finite end date. The operator pays the fees
for its scheduled `MsgExec` transactions. The connected account pays for grant
creation and revocation.

The chain enforces the validator, limit and end date. It does not enforce
reward-only use: the service can delegate available liquid funds within that
limit. Reward-only execution is the validator runner's policy, which is why the
page and the dialog carry the same sentence about what the service may and may
never do.

Replacing a grant resets its remaining limit. It is not an increment to the old
limit. Revoking delegation permission stops subsequent execution under that
grant. Closing the Explorer does not pause a service.

Existing grants are loaded independently of registry discovery. Removed or
changed operator addresses remain visible and revocable. A grant to an old
service account is shown as "Needs attention" with a two-step repair (turn off
the old permission, then turn on again). Old reward-withdrawal permission can be
removed separately; new grants do not request it. Unrelated authorization types
are displayed read only under "Other permissions on this account".

The page opens the grant dialog with the display parameters the widget needs
(`validator_name`, `stake_amount`, `apr`, `schedule`, `current_cap`,
`current_cap_unlimited`, `current_expiration`, `intent`, `minimum_reward`,
`rewards_amount`, `unbonding_seconds`) in addition to the existing
`expected_chain_id`, `validator_address`, `operator_address`, `operator_name`
and `existing_grant`. `existing_grant` is only set for an unexpired grant. The
revoke dialog additionally receives `validator_name`. The widget treats every
new key as display-only and ignores invalid values.

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

A directory entry whose `minimum_reward` is serialised in exponent or decimal
notation is converted exactly when it is an integer (`1e+22`, `1.5e3`, `1.0`);
anything that would need rounding keeps the operator with an unstated minimum
("Minimum reward not stated by the service."). Wrong chain, duplicate
validators and invalid addresses still reject the whole response.

The APR estimate used for the recommended limit and the threshold lines is
inflation × (1 − community tax) ÷ bonded ratio, after the validator's
commission, computed in exact fixed-point arithmetic. Any failure degrades the
estimate to "unknown"; it is never used for signing.

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

Every listed service is checked for its last re-stake, so services that are
not running stand out on every validator card and on every entry of
"Validators that offer auto-compound". The page reads the latest 10
transactions of each service account (`message.sender`), at most four requests
in flight, through one page-level abort controller that Refresh, a registry
reload, an account or endpoint change and unmount cancel; a late answer from a
cancelled run is never shown. Results are cached for five minutes per service
account, so filter chips, searches and selection changes never re-query;
[Check recent activity] and [Check again] bypass the cache for one service. Only
committed successful `MsgExec` transactions containing a delegation by the
listed operator to that validator count as a re-stake; the delegation for the
viewing account is preferred over one for another account and marked
"(for you)".

The verdict compares the last re-stake with the advertised schedule: it is
recent within three intervals plus six hours (at least a day; a day when the
schedule has no readable interval), stale when older, silent when the page
holds no re-stake ("This service hasn't sent any transactions yet" or "No
re-stake in this service's last 10 transactions"), and unknown when the query
failed ("Couldn't check recent re-stakes"). A stale or silent service turns a
row that would otherwise be plain "On" into "Not re-staking" under "Needs
attention"; a check that is still loading or failed never flags a row, and a
re-check in progress keeps the previous verdict.

The check is honest about its limits: ten transactions are a window, not a
history, so a service that re-stakes rarely for anyone can look silent; a
re-stake for another account proves the service runs, not that it will run for
this account before its minimum is reached; and an unavailable query says
nothing either way. The verdict is informational and is never used for signing.

## Development

Use Node 22.22.1 and the declared Yarn 4.13.0:

```sh
corepack yarn install --immutable
corepack yarn test
corepack yarn build
```

The regression suite executes the page's real `setup()` under Node with a
fixture that provides only the wallet, chain and dialog stores, `useRoute`, a
`document` with `baseURI` and no `window` or `localStorage`. Every DOM or
browser-storage access in the page is therefore guarded, and the staking store
and router are optional. Icons are bundled offline: run
`node scripts/fetch-icons.mjs` after adding `mdi:` icons.

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
