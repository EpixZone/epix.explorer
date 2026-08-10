// Registers bundled Iconify collections so icons render without runtime
// requests to api.iconify.design (required when served from .epix domains,
// which cannot load external resources). Regenerate the JSON bundles with
// `node scripts/fetch-icons.mjs` after adding new icons.
import { addCollection } from '@iconify/vue';
import mdi from '@/assets/icons/mdi.json';
import simpleIcons from '@/assets/icons/simple-icons.json';

addCollection(mdi);
addCollection(simpleIcons);
