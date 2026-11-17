import { createApp } from 'vue';
import './styles/tokens.css';
import './styles/atoms.css';
import App from './App.vue';
import { router } from './router';

createApp(App).use(router).mount('#app');
