const savedTheme = localStorage.getItem('android-emulator-manager-theme');
const dark =
  savedTheme === 'dark' ||
  (savedTheme !== 'light' &&
    matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', dark);

import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
createApp(App).mount('#app');
