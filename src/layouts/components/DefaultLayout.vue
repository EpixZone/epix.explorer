<script lang="ts" setup>
import { Icon } from '@iconify/vue';
import { computed, ref } from 'vue';

// Components
import newFooter from '@/layouts/components/NavFooter.vue';
import NavbarThemeSwitcher from '@/layouts/components/NavbarThemeSwitcher.vue';
import NavbarSearch from '@/layouts/components/NavbarSearch.vue';
import ChainProfile from '@/layouts/components/ChainProfile.vue';
import Sponsors from '@/layouts/components/Sponsors.vue';

import { NetworkType, useDashboard } from '@/stores/useDashboard';
import { useBaseStore, useBlockchain } from '@/stores';

import NavBarI18n from './NavBarI18n.vue';
import NavBarWallet from './NavBarWallet.vue';
import type { NavGroup, NavLink, NavSectionTitle, VerticalNavItems } from '../types';
import dayjs from 'dayjs';
import AdBanner from '@/components/ad/AdBanner.vue';

const dashboard = useDashboard();
dashboard.initial();
const blockchain = useBlockchain();
blockchain.randomSetupEndpoint();
const baseStore = useBaseStore();

const current = ref(''); // the current chain
const temp = ref('')
blockchain.$subscribe((m, s) => {
  if (current.value === s.chainName && temp.value != s.endpoint.address) {
    temp.value = s.endpoint.address
    blockchain.initial();
  }
  if (current.value != s.chainName) {
    current.value = s.chainName;
    blockchain.randomSetupEndpoint();
  }
});

const sidebarShow = ref(false);
const sidebarOpen = ref(true);

const changeOpen = (index: Number) => {
  if (index === 0) {
    sidebarOpen.value = !sidebarOpen.value;
  }
};
const showDiscord = window.location.host.search('epix.zone') > -1;

function isNavGroup(nav: VerticalNavItems | any): nav is NavGroup {
  return (<NavGroup>nav).children !== undefined;
}
function isNavLink(nav: VerticalNavItems | any): nav is NavLink {
  return (<NavLink>nav).to !== undefined;
}
function isNavTitle(nav: VerticalNavItems | any): nav is NavSectionTitle {
  return (<NavSectionTitle>nav).heading !== undefined;
}
function selected(route: any, nav: NavLink) {
  const b = route.path === nav.to?.path || route.path.startsWith(nav.to?.path) && nav.title.indexOf('dashboard') === -1
  return b
}
const blocktime = computed(() => {
  return dayjs(baseStore.latest?.block?.header?.time)
});

const behind = computed(() => {
  const current = dayjs().subtract(10, 'minute')
  return blocktime.value.isBefore(current)
});

dayjs()

const show_ad = computed(() => {
  return location.hostname.indexOf('ping.pub') > -1
})

</script>

<template>
  <div class="bg-gray-50 dark:bg-epix-dark min-h-screen">
    <!-- sidebar -->
    <div
      class="w-64 fixed z-50 left-0 top-0 bottom-0 overflow-auto bg-black border-r border-gray-800"
      :class="{ block: sidebarShow, 'hidden xl:!block': !sidebarShow }"
      style="border-radius: 0;">
      <div class="flex justify-between mt-1 pl-4 py-6 mb-2 border-b border-gray-800">
        <RouterLink to="/" class="flex items-center group">
          <div class="relative">
            <img class="w-12 h-12" src="../../assets/logo.svg" alt="Epix Logo" />
          </div>
          <h1 class="flex-1 ml-3 text-2xl font-bold gradient-text">
            Epix
          </h1>
        </RouterLink>
        <div class="pr-4 cursor-pointer xl:!hidden hover:bg-gray-800 rounded-lg p-2 transition-colors duration-200" @click="sidebarShow = false">
          <Icon icon="mdi-close" class="text-xl text-gray-400" />
        </div>
      </div>
      <div v-for="(item, index) of blockchain.computedChainMenu" :key="index" class="px-3 mb-1">
        <div v-if="isNavGroup(item)" :tabindex="index" class="collapse" :class="{
          'collapse-arrow': index > 0 && item?.children?.length > 0,
          'collapse-open': index === 0 && sidebarOpen,
          'collapse-close': index === 0 && !sidebarOpen,
        }">
          <input v-if="index > 0" type="checkbox" class="cursor-pointer !h-12 block" @click="changeOpen(index)" />
          <div
            class="collapse-title !py-0 px-4 flex items-center cursor-pointer rounded-xl hover:bg-gray-800 transition-all duration-200 hover-lift">
            <Icon v-if="item?.icon?.icon" :icon="item?.icon?.icon" class="text-xl mr-3" :class="{
              'text-yellow-500': item?.title === 'Favorite',
              'text-epix-primary': item?.title !== 'Favorite',
            }" />
            <img v-if="item?.icon?.image" :src="item?.icon?.image" class="w-7 h-7 rounded-full mr-3 ring-2 ring-gray-700" alt="Chain icon" />
            <div class="text-base capitalize flex-1 text-gray-200 whitespace-nowrap font-medium">
              {{ item?.title === 'Favorite' ? item?.title : $t(item?.title) }}
            </div>
            <div v-if="item?.badgeContent" class="mr-2 px-2 py-1 text-xs font-semibold rounded-full bg-epix-primary text-white">
              {{ item?.badgeContent }}
            </div>
          </div>
          <div class="collapse-content pl-2">
            <div v-for="(el, key) of item?.children" class="menu w-full !p-0">
              <RouterLink v-if="isNavLink(el)" @click="sidebarShow = false"
                class="hover:bg-gray-800 rounded-lg cursor-pointer px-4 py-3 flex items-center mb-1 transition-all duration-200 hover-lift"
                :class="{
                  '!bg-gray-700 !text-white': selected($route, el),
                }" :to="el.to">
                <Icon v-if="!el?.icon?.image" icon="mdi:chevron-right" class="mr-3 ml-2 text-sm" :class="{
                  'text-white': selected($route, el),
                  'text-gray-400': !selected($route, el),
                }" />
                <img v-if="el?.icon?.image" :src="el?.icon?.image" class="w-6 h-6 rounded-full mr-3 ml-4 ring-1 ring-gray-700" :class="{
                  'ring-white': selected($route, el),
                }" alt="Chain icon" />
                <div class="text-sm capitalize text-gray-300 font-medium" :class="{
                  '!text-white': selected($route, el),
                }">
                  {{ item?.title === 'Favorite' ? el?.title : $t(el?.title) }}
                </div>
              </RouterLink>
            </div>
            <div v-if="index === 0 && dashboard.networkType === NetworkType.Testnet"
              class="menu w-full !p-0">
              <RouterLink
                class="hover:bg-gray-800 rounded-lg cursor-pointer px-4 py-3 flex items-center mb-1 transition-all duration-200 hover-lift"
                :to="`/${blockchain.chainName}/faucet`">
                <Icon icon="mdi:chevron-right" class="mr-3 ml-2 text-sm text-gray-400"></Icon>
                <div class="text-sm capitalize text-gray-300 font-medium">
                  Faucet
                </div>
                <div class="ml-auto px-2 py-1 text-xs font-semibold rounded-full bg-red-500 text-white">
                  New
                </div>
              </RouterLink>
            </div>
          </div>
        </div>

        <RouterLink v-if="isNavLink(item)" :to="item?.to" @click="sidebarShow = false"
          class="cursor-pointer rounded-xl px-4 flex items-center py-3 hover:bg-gray-800 transition-all duration-200 hover-lift">
          <Icon v-if="item?.icon?.icon" :icon="item?.icon?.icon" class="text-xl mr-3" :class="{
            'text-yellow-500': item?.title === 'Favorite',
            'text-epix-primary': item?.title !== 'Favorite',
          }" />
          <img v-if="item?.icon?.image" :src="item?.icon?.image"
            class="w-7 h-7 rounded-full mr-3 ring-2 ring-gray-700" alt="Chain icon" />
          <div class="text-base capitalize flex-1 text-gray-200 whitespace-nowrap font-medium">
            {{ item?.title === 'Favorite' ? item?.title : $t(item?.title) }}
          </div>
          <div v-if="item?.badgeContent" class="px-2 py-1 text-xs font-semibold rounded-full bg-epix-primary text-white">
            {{ item?.badgeContent }}
          </div>
        </RouterLink>
        <div v-if="isNavTitle(item)" class="px-4 text-sm text-gray-400 pb-2 uppercase">
          {{ item?.heading }}
        </div>
      </div>
      <div class="px-3 mt-6">
        <div class="px-4 text-xs pt-2 text-gray-400 pb-3 uppercase font-semibold tracking-wider">
          Tools
        </div>
        <RouterLink to="/wallet/suggest"
          class="py-3 px-4 flex items-center cursor-pointer rounded-xl hover:bg-gray-800 transition-all duration-200 hover-lift mb-1">
          <Icon icon="mdi:frequently-asked-questions" class="text-xl mr-3 text-epix-primary" />
          <div class="text-base capitalize flex-1 text-gray-200 font-medium">
            Wallet Helper
          </div>
        </RouterLink>
        <div v-if="showDiscord" class="px-4 text-xs pt-4 text-gray-400 pb-3 uppercase font-semibold tracking-wider">
          {{ $t('module.sponsors') }}
        </div>
        <Sponsors v-if="showDiscord" />
        <div class="px-4 text-xs pt-4 text-gray-400 pb-3 uppercase font-semibold tracking-wider">{{ $t('module.links') }}</div>
        <a href="https://twitter.com/zone_epix" target="_blank"
          class="py-3 px-4 flex items-center cursor-pointer rounded-xl hover:bg-gray-800 transition-all duration-200 hover-lift mb-1">
          <Icon icon="simple-icons:x" class="text-xl mr-3 text-white" />
          <div class="text-base capitalize flex-1 text-gray-200 font-medium">
            Epix
          </div>
        </a>
        <a v-if="showDiscord" href="https://docs.epix.zone/epix-docs" target="_blank"
          class="py-3 px-4 flex items-center rounded-xl cursor-pointer hover:bg-gray-800 transition-all duration-200 hover-lift mb-1">
          <Icon icon="mdi:book" class="text-xl mr-3 text-green-500" />
          <div class="text-base capitalize flex-1 text-gray-200 font-medium">
            Docs
          </div>
        </a>
      </div>
    </div>
    <div class="xl:!ml-64 px-4 pt-6">
      <!-- header -->
      <div class="flex items-center py-4 modern-card mb-6 px-6 sticky top-4 z-10 shadow-modern">
        <div class="text-2xl pr-4 cursor-pointer xl:!hidden hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg p-2 transition-colors duration-200" @click="sidebarShow = true">
          <Icon icon="mdi-menu" class="text-gray-600 dark:text-gray-400" />
        </div>

        <ChainProfile />

        <div class="flex-1 w-0"></div>

        <div class="flex items-center space-x-2">
          <NavBarI18n class="hidden md:!inline-block" />
          <NavbarThemeSwitcher class="!inline-block" />
          <NavbarSearch class="!inline-block" />
          <NavBarWallet />
        </div>
      </div>

      <!-- 👉 Pages -->
      <div style="min-height: calc(100vh - 200px);" class="pb-8">
        <div v-if="behind" class="modern-card mb-6 p-4 border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20">
          <div class="flex gap-3 items-center">
            <div class="flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                class="stroke-current w-6 h-6 text-red-600 dark:text-red-400">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <span class="text-red-800 dark:text-red-200 font-medium">{{ $t('pages.out_of_sync') }} {{ blocktime.format() }} ({{ blocktime.fromNow() }})</span>
          </div>
        </div>
        <RouterView v-slot="{ Component }">
          <Transition mode="out-in">
            <div>
              <AdBanner v-if="show_ad" />
              <Component :is="Component" />
            </div>
          </Transition>
        </RouterView>
      </div>

      <newFooter />
    </div>
  </div>
</template>
