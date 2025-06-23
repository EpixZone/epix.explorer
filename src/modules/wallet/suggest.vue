<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { suggestChain } from '@leapwallet/cosmos-snap-provider';
import { useDashboard, type ChainConfig, useBlockchain, NetworkType } from '@/stores';
import { CosmosRestClient } from '@/libs/client';
import AdBanner from '@/components/ad/AdBanner.vue';

const error = ref("")
const success = ref("")
const conf = ref("")
const dashboard = useDashboard()
const selected = ref({} as ChainConfig)
const wallet = ref("keplr")
const network = ref(NetworkType.Mainnet)
const mainnet = ref([] as ChainConfig[])
const testnet = ref([] as ChainConfig[])
const chains = computed(() => {
    return network.value === NetworkType.Mainnet? mainnet.value : testnet.value
})

onMounted(() => {
    const chainStore = useBlockchain()

    // Detect network type based on URL
    const isTestnet = window.location.hostname.search("testnet") > -1 || window.location.hostname === "localhost"
    network.value = isTestnet ? NetworkType.Testnet : NetworkType.Mainnet

    selected.value = chainStore.current || Object.values(dashboard.chains)[0]
    initParamsForKeplr()

    dashboard.loadLocalConfig(NetworkType.Mainnet).then((res) => {
        mainnet.value = Object.values<ChainConfig>(res)
        // Auto-select EPIX chain for mainnet if we're on mainnet
        if (!isTestnet && mainnet.value.length > 0) {
            const epixChain = mainnet.value.find(chain => chain.chainName === 'epix')
            if (epixChain) {
                selected.value = epixChain
                initParamsForKeplr()
            }
        }
    })
    dashboard.loadLocalConfig(NetworkType.Testnet).then((res) => {
        testnet.value = Object.values<ChainConfig>(res)
        // Auto-select EPIX chain for testnet if we're on testnet
        if (isTestnet && testnet.value.length > 0) {
            const epixChain = testnet.value.find(chain => chain.chainName === 'epix')
            if (epixChain) {
                selected.value = epixChain
                initParamsForKeplr()
            }
        }
    })
})

function onchange() {
    // Clear messages when configuration changes
    error.value = ""
    success.value = ""

    // Auto-select EPIX chain when network changes
    const currentChains = network.value === NetworkType.Mainnet ? mainnet.value : testnet.value
    if (currentChains.length > 0) {
        const epixChain = currentChains.find(chain => chain.chainName === 'epix')
        if (epixChain) {
            selected.value = epixChain
        }
    }

    wallet.value === "keplr" ? initParamsForKeplr() : initSnap()
}

async function initParamsForKeplr() {
    try {
        error.value = ""
        success.value = ""
        const chain = selected.value
        if(!chain.endpoints?.rest?.at(0)) {
            error.value = "No REST endpoint configured for this chain"
            return
        }
        const client = CosmosRestClient.newDefault(chain.endpoints.rest?.at(0)?.address || "")
        const b = await client.getBaseBlockLatest()
        const chainid = b.block.header.chain_id

    const gasPriceStep = chain.keplrPriceStep || {
        low: 0.01,
        average: 0.025,
        high: 0.03,
    }
    const coinDecimals = chain.assets[0].denom_units.find(x => x.denom === chain.assets[0].symbol.toLowerCase())?.exponent || 6
    conf.value = JSON.stringify({
        chainId: chainid,
        chainName: chain.chainName,
        rpc: chain.endpoints?.rpc?.at(0)?.address,
        rest: chain.endpoints?.rest?.at(0)?.address,
        bip44: {
            coinType: Number(chain.coinType),
        },
        bech32Config: {
            bech32PrefixAccAddr: chain.bech32Prefix,
            bech32PrefixAccPub: `${chain.bech32Prefix}pub`,
            bech32PrefixValAddr: `${chain.bech32Prefix}valoper`,
            bech32PrefixValPub: `${chain.bech32Prefix}valoperpub`,
            bech32PrefixConsAddr: `${chain.bech32Prefix}valcons`,
            bech32PrefixConsPub: `${chain.bech32Prefix}valconspub`,
        },
        currencies: [
            {
                coinDenom: chain.assets[0].symbol,
                coinMinimalDenom: chain.assets[0].base,
                coinDecimals,
                coinGeckoId: chain.assets[0].coingecko_id || 'unknown',
            },
        ],
        feeCurrencies: [
            {
                coinDenom: chain.assets[0].symbol,
                coinMinimalDenom: chain.assets[0].base,
                coinDecimals,
                coinGeckoId: chain.assets[0].coingecko_id || 'unknown',
                gasPriceStep,
            },
        ],
        stakeCurrency: {
            coinDenom: chain.assets[0].symbol,
            coinMinimalDenom: chain.assets[0].base,
            coinDecimals,
            coinGeckoId: chain.assets[0].coingecko_id || 'unknown',
        },
        features: chain.keplrFeatures || [],
    }, null, '\t')
    } catch (e) {
        error.value = `Failed to initialize Keplr configuration: ${e.message || e}`
        conf.value = ""
    }
}

async function initSnap() {
    try {
        error.value = ""
        success.value = ""
        const chain = selected.value
        const [token] = chain.assets

        if(!chain.endpoints?.rest?.at(0)) {
            error.value = "No REST endpoint configured for this chain"
            return
        }
        const client = CosmosRestClient.newDefault(chain.endpoints.rest?.at(0)?.address || "")
        const b = await client.getBaseBlockLatest()
        const chainId = b.block.header.chain_id

    conf.value = JSON.stringify({
        chainId,
        chainName: chain.chainName,
        bech32Config: {
            bech32PrefixAccAddr: chain.bech32Prefix,
        },
        bip44: {
            coinType: Number(chain.coinType),
        },
        feeCurrencies: [
            {
            coinDenom: token.display,
            coinMinimalDenom: token.base,
            coinDecimals: token.denom_units.find(x => x.denom === token.display)?.exponent || 6,
            coinGeckoId: token.coingecko_id,
            gasPriceStep: {
                low: 0.0625,
                average: 0.5,
                high: 62.5,
            },
            },
        ],
    }, null, '\t')
    } catch (e) {
        error.value = `Failed to initialize Metamask configuration: ${e.message || e}`
        conf.value = ""
    }
}

function suggest() {
    // Clear previous messages
    error.value = ""
    success.value = ""

    if(wallet.value === "keplr") {
        // @ts-ignore
        if (window.keplr) {
            try {
                // @ts-ignore
                window.keplr.experimentalSuggestChain(JSON.parse(conf.value)).then(() => {
                    success.value = `Successfully suggested ${selected.value.chainName} to Keplr wallet!`
                }).catch(e => {
                    error.value = `Failed to suggest chain to Keplr: ${e.message || e}`
                })
            } catch (e) {
                error.value = `Error parsing configuration: ${e.message || e}`
            }
        } else {
            error.value = "Keplr wallet is not installed or not available. Please install Keplr extension."
        }
    } else {
        try {
            suggestChain(JSON.parse(conf.value));
            success.value = `Successfully suggested ${selected.value.chainName} to Metamask Snap!`
        } catch (e) {
            error.value = `Failed to suggest chain to Metamask: ${e.message || e}`
        }
    }
}

</script>

<template>
    <div class="modern-card shadow-modern p-6 text-center">
        <h2 class="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Chain Configuration Generator</h2>

        <div class="flex flex-wrap items-center justify-center gap-4 mb-6">
            <div class="flex flex-col">
                <label for="network-select" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Network</label>
                <select id="network-select" v-model="network" class="modern-input select bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                    <option :value="NetworkType.Mainnet">Mainnet</option>
                    <option :value="NetworkType.Testnet">Testnet</option>
                </select>
            </div>

            <div class="flex flex-col">
                <label for="chain-select" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Chain</label>
                <select id="chain-select" v-model="selected" class="modern-input select bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white min-w-48" @change="onchange">
                    <option v-for="c in chains" :value="c">
                        {{ c.chainName }}
                    </option>
                </select>
            </div>

            <div class="flex flex-col">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Wallet</span>
                <div class="flex items-center gap-4">
                    <label class="flex items-center cursor-pointer">
                        <input type="radio" v-model="wallet" value="keplr" class="radio radio-primary mr-2" @change="onchange" />
                        <span class="text-gray-700 dark:text-gray-300">Keplr</span>
                    </label>
                    <label class="flex items-center cursor-pointer">
                        <input type="radio" v-model="wallet" value="metamask" class="radio radio-primary mr-2" @change="onchange"/>
                        <span class="text-gray-700 dark:text-gray-300">Metamask</span>
                    </label>
                </div>
            </div>
        </div>

        <div class="mt-6">
            <label for="config-textarea" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block text-left">Configuration JSON</label>
            <textarea id="config-textarea" v-model="conf" class="modern-input w-full bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white font-mono text-sm" rows="15" placeholder="Configuration will appear here..."></textarea>
        </div>

        <div class="mt-6 mb-6">
            <button class="modern-button px-6 py-3 text-white font-medium" @click="suggest">
                Suggest {{ selected.chainName }} to {{ wallet }}
            </button>

            <!-- Success Message -->
            <div v-if="success" class="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border-l-4 border-green-500">
                <p class="text-sm text-green-800 dark:text-green-200">
                    {{ success }}
                </p>
            </div>

            <!-- Error Message -->
            <div v-if="error" class="mt-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border-l-4 border-red-500">
                <p class="text-sm text-red-800 dark:text-red-200">
                    {{ error }}
                </p>
            </div>

            <div class="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border-l-4 border-blue-500">
                <p class="text-sm text-blue-800 dark:text-blue-200">
                    If the chain is not officially supported on Keplr/Metamask Snap, you can submit these parameters to enable Keplr/Metamask Snap.
                </p>
            </div>
        </div>

        <AdBanner id="suggest-banner-ad" unit="banner" width="970px" height="90px" />
    </div>
</template>
