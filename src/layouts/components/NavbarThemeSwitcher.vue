<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { onMounted, computed } from 'vue';
import { useBaseStore } from '@/stores';

const themeMap: Record<string, string> = {
    system: 'mdi-laptop',
    light: 'mdi-weather-sunny',
    dark: 'mdi-weather-night',
};
const baseStore = useBaseStore();
const theme = computed(() => {
    return baseStore.theme;
});

const changeMode = (val?: 'dark' | 'light') => {
    let value: 'dark' | 'light' = 'dark';
    const currentValue: 'dark' | 'light' = val || theme.value;
    if (currentValue === 'dark') {
        value = 'light';
    }
    if (value === 'light') {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
    }
    document.documentElement.setAttribute('data-theme', value);
    window.localStorage.setItem('theme', value);
    baseStore.theme = value;
};

onMounted(() => {
    changeMode(theme.value === 'light' ? 'dark' : 'light');
});
</script>

<template>
    <div class="tooltip tooltip-bottom delay-1000">
        <button
            class="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 hover-lift"
            @click="changeMode()"
        >
            <Icon :icon="themeMap?.[theme]" class="text-xl text-gray-600 dark:text-gray-400 hover:text-epix-primary transition-colors duration-200" />
        </button>
    </div>
</template>
