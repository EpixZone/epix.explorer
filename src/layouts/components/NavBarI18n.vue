<script lang="ts" setup>
import { ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';

const i18nLangs: Array<{ label: string; i18nLang: string }> = [
    {
        label: 'English',
        i18nLang: 'en',
    },
    {
        label: '中文',
        i18nLang: 'zh',
    },
    {
        label: 'Indonesian',
        i18nLang: 'id',
    },
    {
        label: '日本語',
        i18nLang: 'ja',
    },
    {
        label: '한국인',
        i18nLang: 'ko',
    },
    {
        label: 'Deutsch',
        i18nLang: 'de',
    },
    {
        label: 'Español',
        i18nLang: 'es',
    },
];

let locale = ref(useI18n({ useScope: 'global' }).locale);
watch(locale, (val) => {
    document.documentElement.setAttribute('lang', val as string);
});

let currentLang = ref(localStorage.getItem('lang') || 'en');

watch(currentLang, (val: string) => {
    document.documentElement.setAttribute('lang', val as string);
});

const handleLangChange = (lang: string) => {
    locale.value = lang;
    currentLang.value = lang;
    localStorage.setItem('lang', lang);
};
</script>

<template>
    <div
        class="dropdown"
        :class="
            currentLang === 'ar'
                ? 'dropdown-right'
                : 'dropdown-bottom dropdown-end'
        "
    >
        <label tabindex="0" class="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 hover-lift cursor-pointer">
            <Icon
                icon="mdi-translate"
                class="text-xl text-gray-600 dark:text-gray-400 hover:text-epix-primary transition-colors duration-200"
            />
        </label>
        <ul
            tabindex="0"
            class="dropdown-content menu p-3 shadow-modern-lg modern-card rounded-xl w-44 mt-2"
        >
            <li v-for="lang in i18nLangs" :key="lang.i18nLang">
                <a
                    class="hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg py-2 px-3 transition-colors duration-200 text-sm font-medium"
                    :class="{ 'text-epix-primary bg-epix-primary/10': currentLang === lang.i18nLang }"
                    @click="handleLangChange(lang.i18nLang)">
                    {{ lang.label }}
                </a>
            </li>
        </ul>
    </div>
</template>
