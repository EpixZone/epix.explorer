<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
// Removed Cosmos Snap imports - focusing on EVM integration
import { useDashboard, type ChainConfig, useBlockchain, NetworkType } from '@/stores';
import { CosmosRestClient } from '@/libs/client';
import AdBanner from '@/components/ad/AdBanner.vue';

const error = ref("")
const success = ref("")
const conf = ref("")
const dashboard = useDashboard()
const selected = ref({} as ChainConfig)
const wallet = ref("keplr") // Default to Keplr consensus layer for EPIX
const selectedConsensusWallet = ref("keplr") // Which consensus wallet to use: keplr or leap
const network = ref(NetworkType.Mainnet)
const mainnet = ref([] as ChainConfig[])
const testnet = ref([] as ChainConfig[])
const chains = computed(() => {
    return network.value === NetworkType.Mainnet? mainnet.value : testnet.value
})
const route = useRoute()
const router = useRouter()

// Track if component is being unmounted to prevent state updates
const isUnmounting = ref(false)

// Cleanup function to cancel any ongoing operations
function cleanup() {
    isUnmounting.value = true
    // Clear any pending timeouts or intervals if they exist
    // This helps prevent state updates after component unmount
}

// Route guard to ensure proper cleanup when navigating away
onBeforeRouteLeave((to, from, next) => {
    cleanup()
    next()
})

// Component unmount cleanup
onBeforeUnmount(() => {
    cleanup()
})

onMounted(() => {
    const chainStore = useBlockchain()

    // Detect network type based on URL
    const isTestnet = false //window.location.hostname.search("testnet") > -1 || window.location.hostname === "localhost"
    network.value = isTestnet ? NetworkType.Testnet : NetworkType.Mainnet

    // Check for URL parameters to set wallet type
    const urlParams = new URLSearchParams(window.location.search)
    const walletParam = urlParams.get('wallet')
    if (walletParam === 'keplr' || walletParam === 'consensus') {
        wallet.value = 'keplr'
    } else if (walletParam === 'metamask' || walletParam === 'evm') {
        wallet.value = 'metamask-evm'
    }

    selected.value = chainStore.current || Object.values(dashboard.chains)[0]

    // Use setTimeout to defer async operations and prevent blocking navigation
    setTimeout(() => {
        if (isUnmounting.value) return
        initParamsForKeplr()
    }, 0)

    // Load configurations asynchronously without blocking
    setTimeout(() => {
        if (isUnmounting.value) return

        dashboard.loadLocalConfig(NetworkType.Mainnet).then((res) => {
            if (isUnmounting.value) return
            mainnet.value = Object.values<ChainConfig>(res)
            // Auto-select EPIX chain for mainnet if we're on mainnet
            if (!isTestnet && mainnet.value.length > 0) {
                const epixChain = mainnet.value.find(chain => chain.chainName === 'epix')
                if (epixChain && !isUnmounting.value) {
                    selected.value = epixChain
                    setTimeout(() => {
                        if (!isUnmounting.value) initParamsForKeplr()
                    }, 0)
                }
            }
        }).catch((e) => {
            if (!isUnmounting.value) {
                console.error('Failed to load mainnet config:', e)
            }
        })

        dashboard.loadLocalConfig(NetworkType.Testnet).then((res) => {
            if (isUnmounting.value) return
            testnet.value = Object.values<ChainConfig>(res)
            // Auto-select EPIX chain for testnet if we're on testnet
            if (isTestnet && testnet.value.length > 0) {
                const epixChain = testnet.value.find(chain => chain.chainName === 'epix')
                if (epixChain && !isUnmounting.value) {
                    selected.value = epixChain
                    setTimeout(() => {
                        if (!isUnmounting.value) initParamsForKeplr()
                    }, 0)
                }
            }
        }).catch((e) => {
            if (!isUnmounting.value) {
                console.error('Failed to load testnet config:', e)
            }
        })
    }, 100) // Small delay to ensure component is fully mounted
})

function updateURL() {
    // Update the URL with the current wallet parameter
    const currentUrl = new URL(window.location.href)
    if (wallet.value === 'keplr') {
        currentUrl.searchParams.set('wallet', 'consensus')
    } else if (wallet.value === 'metamask-evm') {
        currentUrl.searchParams.set('wallet', 'evm')
    }

    // Update the URL without triggering a page reload
    window.history.replaceState({}, '', currentUrl.toString())
}

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

    // Update URL when wallet type changes
    updateURL()

    if (wallet.value === "keplr") {
        // Use setTimeout to ensure the selected chain is updated before generating config
        setTimeout(() => {
            if (!isUnmounting.value) {
                initParamsForKeplr()
            }
        }, 0)
    } else {
        // For EVM MetaMask, we don't need to generate a config
        conf.value = "EVM MetaMask integration - no configuration needed"
    }
}

async function initParamsForKeplr() {
    try {
        if (isUnmounting.value) return // Don't proceed if component is unmounting

        error.value = ""
        success.value = ""
        const chain = selected.value
        if(!chain.endpoints?.rest?.at(0)) {
            if (!isUnmounting.value) {
                error.value = "No REST endpoint configured for this chain"
            }
            return
        }

        // Use the chain ID from the configuration instead of fetching from API
        // This ensures we get the correct chain ID for the selected network
        const chainid = (chain as any).chain_id || `${chain.chainName}_${network.value === NetworkType.Testnet ? '1917' : '1916'}-1`

    const gasPriceStep = chain.keplrPriceStep || {
        low: 0.01,
        average: 0.025,
        high: 0.03,
    }
    const coinDecimals = chain.assets[0].denom_units.find(x => x.denom === chain.assets[0].symbol.toLowerCase())?.exponent || 6
    conf.value = JSON.stringify({
        chainId: chainid,
        chainName: chain.prettyName || chain.chainName,
        rpc: chain.endpoints?.rpc?.at(0)?.address,
        rest: chain.endpoints?.rest?.at(0)?.address,
        chainSymbolImageUrl: chain.logo,
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
                coinImageUrl: chain.logo,
            },
        ],
        feeCurrencies: [
            {
                coinDenom: chain.assets[0].symbol,
                coinMinimalDenom: chain.assets[0].base,
                coinDecimals,
                coinGeckoId: chain.assets[0].coingecko_id || 'unknown',
                gasPriceStep,
                coinImageUrl: chain.logo,
            },
        ],
        stakeCurrency: {
            coinDenom: chain.assets[0].symbol,
            coinMinimalDenom: chain.assets[0].base,
            coinDecimals,
            coinGeckoId: chain.assets[0].coingecko_id || 'unknown',
            coinImageUrl: chain.logo,
        },
        features: chain.keplrFeatures || [],
    }, null, '\t')
    } catch (e) {
        if (!isUnmounting.value) {
            error.value = `Failed to initialize Keplr configuration: ${e.message || e}`
            conf.value = ""
        }
    }
}

// initSnap function removed - focusing on EVM integration

function getEvmChainConfig() {
    const chain = selected.value
    const isTestnet = network.value === NetworkType.Testnet
    return {
        chainId: isTestnet ? '0x77d' : '0x77c', // 1917 in hex for testnet, 1916 for mainnet
        chainName: isTestnet ? 'Epix Testnet' : 'Epix',
        rpcUrls: [isTestnet ? 'https://evmrpc.testnet.epix.zone/' : 'https://evmrpc.epix.zone/'],
        nativeCurrency: {
            name: 'EPIX',
            symbol: 'EPIX',
            decimals: 18,
        },
        blockExplorerUrls: [isTestnet ? 'https://testscan.epix.zone/' : 'https://scan.epix.zone/'],
        iconUrls: [chain.logo || 'https://raw.githubusercontent.com/EpixZone/assets/refs/heads/main/images/icons/icon.png']
    }
}

// Add EVM MetaMask integration for EPIX chain
async function addToMetaMaskEVM() {
    // @ts-ignore
    if (!window.ethereum) {
        error.value = "MetaMask is not installed or not available. Please install MetaMask extension."
        return
    }

    const evmChainConfig = getEvmChainConfig()

    try {
        // @ts-ignore
        await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [evmChainConfig],
        })

        success.value = `Successfully added ${selected.value.prettyName || selected.value.chainName} to MetaMask!`
    } catch (e: any) {
        // MetaMask sometimes throws errors even when the operation succeeds
        // Always try to verify if the network was actually added successfully
        // by attempting to switch to it, regardless of the error
        try {
            const chainId = evmChainConfig.chainId

            // @ts-ignore
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId }],
            })

            // If we can switch to it, it was added successfully
            success.value = `Successfully added ${selected.value.prettyName || selected.value.chainName} to MetaMask!`

        } catch (switchError: any) {
            // Handle user rejection of the original add request
            if (e && e.code === 4001) {
                error.value = "User rejected the request to add the chain to MetaMask."
                return
            }

            // Check if this is a "chain already exists" case
            if (e && (e.code === 4902 || (e.message && e.message.includes('already exists')))) {
                success.value = `${selected.value.prettyName || selected.value.chainName} is already added to MetaMask!`
                return
            }

            // Extract error message safely for real errors
            let errorMessage = 'Unknown error occurred while adding chain to MetaMask'

            if (e && typeof e === 'object') {
                if (e.message && typeof e.message === 'string') {
                    errorMessage = e.message
                } else if (e.code) {
                    errorMessage = `MetaMask error code: ${e.code}`
                } else {
                    errorMessage = 'MetaMask returned an error object without a readable message'
                }
            } else if (typeof e === 'string') {
                errorMessage = e
            }

            error.value = `Failed to add chain to MetaMask: ${errorMessage}`
        }
    }
}

// Add EVM Trust Wallet integration for EPIX chain
async function addToTrustWalletEVM() {
    // @ts-ignore
    const provider = window.trustwallet
    if (!provider) {
        error.value = "Trust Wallet is not installed or not available. Please install the Trust Wallet extension."
        return
    }

    const evmChainConfig = getEvmChainConfig()

    try {
        await provider.request({
            method: 'wallet_addEthereumChain',
            params: [evmChainConfig],
        })

        success.value = `Successfully added ${selected.value.prettyName || selected.value.chainName} to Trust Wallet!`
    } catch (e: any) {
        if (e && e.code === 4001) {
            error.value = "User rejected the request to add the chain to Trust Wallet."
            return
        }
        const errorMessage = e?.message || 'Unknown error occurred while adding chain to Trust Wallet'
        error.value = `Failed to add chain to Trust Wallet: ${errorMessage}`
    }
}

async function suggest() {
    // Clear previous messages
    error.value = ""
    success.value = ""

    if(wallet.value === "keplr") {
        if (selectedConsensusWallet.value === "leap") {
            // @ts-ignore
            if (window.leap) {
                try {
                    // @ts-ignore
                    await window.leap.experimentalSuggestChain(JSON.parse(conf.value))
                    success.value = `Successfully added ${selected.value.prettyName || selected.value.chainName} to Leap wallet!`
                } catch (e) {
                    error.value = `Failed to add chain to Leap: ${e.message || e}`
                }
            } else {
                error.value = "Leap wallet is not installed or not available. Please install the Leap extension."
            }
        } else {
            // @ts-ignore
            if (window.keplr) {
                try {
                    // @ts-ignore
                    await window.keplr.experimentalSuggestChain(JSON.parse(conf.value))
                    success.value = `Successfully added ${selected.value.prettyName || selected.value.chainName} to Keplr wallet!`
                } catch (e) {
                    error.value = `Failed to add chain to Keplr: ${e.message || e}`
                }
            } else {
                error.value = "Keplr wallet is not installed or not available. Please install Keplr extension."
            }
        }
    } else {
        // Default to MetaMask EVM integration
        await addToMetaMaskEVM()
    }
}

function suggestToLeap() {
    selectedConsensusWallet.value = "leap"
    suggest()
}

function suggestToKeplr() {
    selectedConsensusWallet.value = "keplr"
    suggest()
}
</script>

<template>
    <div class="max-w-4xl mx-auto">
        <!-- Header Section -->
        <div class="modern-card shadow-modern p-8 text-center mb-6">
            <div class="flex items-center justify-center mb-4">
                <Icon icon="mdi:wallet-plus" class="text-4xl text-epix-primary mr-3" />
                <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Add Epix to Your Favorite Wallet</h1>
            </div>
            <p class="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                Connect to the Epix blockchain through your preferred wallet. Choose between consensus layer operations or EVM-compatible interactions.
            </p>
        </div>

        <!-- Network Selection - Hidden but still functional -->
        <div class="hidden">
            <select v-model="network" @change="onchange">
                <option :value="NetworkType.Mainnet">Mainnet</option>
                <option :value="NetworkType.Testnet">Testnet</option>
            </select>
        </div>

        <!-- Wallet Tabs -->
        <div class="modern-card shadow-modern overflow-hidden">
            <!-- Tab Headers -->
            <div class="flex border-b border-gray-200 dark:border-gray-700">
                <button
                    @click="wallet = 'keplr'; onchange()"
                    :class="[
                        'flex-1 px-6 py-4 text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2',
                        wallet === 'keplr'
                            ? 'bg-epix-primary text-white border-b-2 border-epix-primary'
                            : 'text-gray-600 dark:text-gray-400 hover:text-epix-primary hover:bg-gray-50 dark:hover:bg-gray-800'
                    ]"
                >
                    <Icon icon="mdi:shield-account" class="text-lg" />
                    Consensus Layer
                </button>
                <button
                    @click="wallet = 'metamask-evm'; onchange()"
                    :class="[
                        'flex-1 px-6 py-4 text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2',
                        wallet === 'metamask-evm'
                            ? 'bg-epix-primary text-white border-b-2 border-epix-primary'
                            : 'text-gray-600 dark:text-gray-400 hover:text-epix-primary hover:bg-gray-50 dark:hover:bg-gray-800'
                    ]"
                >
                    <Icon icon="mdi:code-braces" class="text-lg" />
                    EVM Layer
                </button>
            </div>

            <!-- Tab Content -->
            <div class="p-8">
                <!-- Keplr Tab Content -->
                <div v-if="wallet === 'keplr'" class="space-y-6">
                    <div class="text-center">
                        <Icon icon="mdi:shield-account" class="text-6xl text-epix-primary mx-auto mb-4" />
                        <h3 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">Consensus Layer Wallets</h3>

                        <p class="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-8">
                            Use consensus layer wallets for staking, governance participation, voting on proposals, and other core blockchain functions.
                        </p>

                        <!-- Wallet Tiles -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto mb-8">
                            <!-- Keplr Wallet Tile -->
                            <div class="modern-card p-6 hover-lift cursor-pointer transition-all duration-200 border-2 border-transparent hover:border-epix-primary" @click="suggestToKeplr">
                                <div class="flex flex-col items-center text-center">
                                    <img src="/logos/Keplr.png" alt="Keplr" class="w-16 h-16 mb-4 rounded-lg" />
                                    <h4 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Keplr</h4>
                                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Most popular Cosmos wallet</p>
                                    <button class="modern-button px-6 py-2 text-white font-medium text-sm w-full">
                                        Add Epix to Keplr
                                    </button>
                                </div>
                            </div>

                            <!-- Leap Wallet Tile -->
                            <div class="modern-card p-6 hover-lift cursor-pointer transition-all duration-200 border-2 border-transparent hover:border-epix-primary" @click="suggestToLeap">
                                <div class="flex flex-col items-center text-center">
                                    <img src="/logos/Leap.png" alt="Leap" class="w-16 h-16 mb-4 rounded-lg" />
                                    <h4 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Leap</h4>
                                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Advanced Cosmos wallet</p>
                                    <button class="modern-button px-6 py-2 text-white font-medium text-sm w-full">
                                        Add Epix to Leap
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Success/Error Messages for Consensus Layer -->
                        <div v-if="success && wallet === 'keplr'" class="mt-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border-l-4 border-green-500">
                            <div class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                <p class="text-sm text-green-800 dark:text-green-200 font-medium">
                                    {{ success }}
                                </p>
                            </div>
                        </div>

                        <div v-if="error && wallet === 'keplr'" class="mt-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border-l-4 border-red-500">
                            <div class="flex items-center">
                                <Icon icon="mdi:alert-circle" class="text-red-500 mr-2" />
                                <p class="text-sm text-red-800 dark:text-red-200 font-medium">
                                    {{ error }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                        <h4 class="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center">
                            <Icon icon="mdi:information" class="text-epix-primary mr-2" />
                            What you can do with Keplr:
                        </h4>
                        <ul class="space-y-2 text-gray-600 dark:text-gray-400">
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Stake EPIX tokens and earn rewards
                            </li>
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Participate in governance and vote on proposals
                            </li>
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Send and receive EPIX tokens
                            </li>
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Interact with Cosmos SDK modules
                            </li>
                        </ul>
                    </div>

                    <!-- Configuration JSON for advanced users -->
                    <div class="mt-8">
                        <details class="bg-gray-50 dark:bg-gray-800 rounded-lg" open>
                            <summary class="p-4 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-epix-primary">
                                Advanced: View Configuration JSON
                            </summary>
                            <div class="p-4 border-t border-gray-200 dark:border-gray-700">
                                <textarea v-model="conf" class="modern-input w-full bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white font-mono text-xs" rows="12" readonly placeholder="Configuration will appear here..."></textarea>
                            </div>
                        </details>
                    </div>
                </div>

                <!-- MetaMask Tab Content -->
                <div v-else-if="wallet === 'metamask-evm'" class="space-y-6">
                    <div class="text-center">
                        <Icon icon="mdi:code-braces" class="text-6xl text-epix-primary mx-auto mb-4" />
                        <h3 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">EVM Layer Wallets</h3>

                        <p class="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-8">
                            Use EVM-compatible wallets for DeFi applications, gaming, NFTs, and permissionless smart contract development.
                        </p>

                        <!-- Wallet Tiles -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto mb-8">
                            <!-- MetaMask Wallet Tile -->
                            <div class="modern-card p-6 hover-lift cursor-pointer transition-all duration-200 border-2 border-transparent hover:border-epix-primary" @click="suggest">
                                <div class="flex flex-col items-center text-center">
                                    <img src="/logos/MetaMask.svg" alt="MetaMask" class="w-16 h-16 mb-4 rounded-lg" />
                                    <h4 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">MetaMask</h4>
                                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Most popular EVM wallet</p>
                                    <button class="modern-button px-6 py-2 text-white font-medium text-sm w-full">
                                        Add Epix to MetaMask
                                    </button>
                                </div>
                            </div>

                            <!-- Trust Wallet Tile -->
                            <div class="modern-card p-6 hover-lift cursor-pointer transition-all duration-200 border-2 border-transparent hover:border-epix-primary" @click="addToTrustWalletEVM">
                                <div class="flex flex-col items-center text-center">
                                    <img src="/logos/Trust.png" alt="Trust Wallet" class="w-16 h-16 mb-4 rounded-lg" />
                                    <h4 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Trust Wallet</h4>
                                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Mobile-first crypto wallet</p>
                                    <button class="modern-button px-6 py-2 text-white font-medium text-sm w-full">
                                        Add Epix to Trust Wallet
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Success/Error Messages for EVM Layer -->
                        <div v-if="success && wallet === 'metamask-evm'" class="mt-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border-l-4 border-green-500">
                            <div class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                <p class="text-sm text-green-800 dark:text-green-200 font-medium">
                                    {{ success }}
                                </p>
                            </div>
                        </div>

                        <div v-if="error && wallet === 'metamask-evm'" class="mt-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border-l-4 border-red-500">
                            <div class="flex items-center">
                                <Icon icon="mdi:alert-circle" class="text-red-500 mr-2" />
                                <p class="text-sm text-red-800 dark:text-red-200 font-medium">
                                    {{ error }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                        <h4 class="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center">
                            <Icon icon="mdi:information" class="text-epix-primary mr-2" />
                            What you can do with MetaMask:
                        </h4>
                        <ul class="space-y-2 text-gray-600 dark:text-gray-400">
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Interact with DeFi protocols and DEXs
                            </li>
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Play blockchain games and collect NFTs
                            </li>
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Deploy and interact with smart contracts
                            </li>
                            <li class="flex items-center">
                                <Icon icon="mdi:check-circle" class="text-green-500 mr-2" />
                                Use familiar Ethereum-compatible tools
                            </li>
                        </ul>
                    </div>

                    <!-- EVM Network Details -->
                    <div class="mt-8">
                        <details class="bg-gray-50 dark:bg-gray-800 rounded-lg" open>
                            <summary class="p-4 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-epix-primary">
                                Advanced: EVM Network Details
                            </summary>
                            <div class="p-4 border-t border-gray-200 dark:border-gray-700">
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span class="font-medium text-gray-700 dark:text-gray-300">Network Name:</span>
                                        <span class="text-gray-600 dark:text-gray-400 ml-2">{{ network === NetworkType.Testnet ? 'Epix Testnet' : 'Epix' }}</span>
                                    </div>
                                    <div>
                                        <span class="font-medium text-gray-700 dark:text-gray-300">Chain ID:</span>
                                        <span class="text-gray-600 dark:text-gray-400 ml-2">{{ network === NetworkType.Testnet ? '1917' : '1916' }}</span>
                                    </div>
                                    <div>
                                        <span class="font-medium text-gray-700 dark:text-gray-300">RPC URL:</span>
                                        <span class="text-gray-600 dark:text-gray-400 ml-2 font-mono text-xs">{{ network === NetworkType.Testnet ? 'https://evmrpc.testnet.epix.zone/' : 'https://evmrpc.epix.zone/' }}</span>
                                    </div>
                                    <div>
                                        <span class="font-medium text-gray-700 dark:text-gray-300">Explorer:</span>
                                        <span class="text-gray-600 dark:text-gray-400 ml-2 font-mono text-xs">{{ network === NetworkType.Testnet ? 'http://testscan.epix.zone/' : 'http://scan.epix.zone/' }}</span>
                                    </div>
                                </div>
                            </div>
                        </details>
                    </div>
                </div>
            </div>
        </div>

        <!-- Additional Information -->
        <div class="modern-card shadow-modern p-6 mt-6">
            <div class="text-center">
                <Icon icon="mdi:help-circle" class="text-3xl text-epix-primary mx-auto mb-3" />
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Need Help?</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4">
                    If you're having trouble adding the network, make sure you have the latest version of your wallet extension installed.
                </p>
                <div class="flex flex-wrap justify-center gap-4">
                    <a href="https://docs.epix.zone/epix-docs" target="_blank" class="px-4 py-2 text-sm flex items-center bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors duration-200">
                        <Icon icon="mdi:book-open" class="mr-2 text-base" />
                        Documentation
                    </a>
                    <a href="https://discord.com/invite/bF2GKHgrfv" target="_blank" class="px-4 py-2 text-sm flex items-center bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors duration-200">
                        <Icon icon="mdi:discord" class="mr-2 text-base" />
                        Join Discord
                    </a>
                </div>
            </div>
        </div>

        <AdBanner id="suggest-banner-ad" unit="banner" width="970px" height="90px" class="mt-6" />
    </div>
</template>
