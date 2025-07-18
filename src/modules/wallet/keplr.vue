<script setup lang="ts">
import { ref } from 'vue';
import { useDashboard, type ChainConfig, useBlockchain } from '@/stores';
import { CosmosRestClient } from '@/libs/client';
import { onMounted } from 'vue';
import AdBanner from '@/components/ad/AdBanner.vue';

const error = ref("")
const conf = ref("")
const dashboard = useDashboard()
const selected = ref({} as ChainConfig)

onMounted(() => {
    const chainStore = useBlockchain()
    selected.value = chainStore.current || Object.values(dashboard.chains)[0]
  debugger;
    initParamsForKeplr()
})
async function initParamsForKeplr() {
    const chain = selected.value
    if(!chain.endpoints?.rest?.at(0)) throw new Error("Endpoint does not set");
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
        coinType: Number(chain.coinType),
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
        gasPriceStep,
        stakeCurrency: {
            coinDenom: chain.assets[0].symbol,
            coinMinimalDenom: chain.assets[0].base,
            coinDecimals,
            coinGeckoId: chain.assets[0].coingecko_id || 'unknown',
        },
        features: chain.keplrFeatures || [],
    }, null, '\t')
}

function suggest() {
    // @ts-ignore
    if (window.keplr) {
        // @ts-ignore
        window.keplr.experimentalSuggestChain(JSON.parse(conf.value)).catch(e => {
            error.value = e
        })
    }
}
</script>

<template>
    <div class="modern-card p-4 text-center shadow-modern">
        <AdBanner id="keplr-banner-ad" unit="banner" width="970px" height="90px" />
        <div class="flex gap-4 justify-center items-center">
            <select v-model="selected" class="modern-input px-3 py-2" @change="initParamsForKeplr">
                <option v-for="c in dashboard.chains" :value="c">
                    {{ c.chainName }}
                </option>
            </select>
            <button class="modern-button px-10 py-2" @click="suggest">Add {{ selected.chainName }} TO Keplr Wallet</button>
        </div>
        <div class="text-gray-900 dark:text-white mt-5">
            <textarea v-model="conf" class="modern-input w-full p-3" rows="15"></textarea>
        </div>
        <div class="mt-4 mb-4 text-gray-600 dark:text-gray-400">
            If the chain is not offically support on Keplr, you can submit these parameters to enable Keplr.
        </div>
    </div>
</template>
