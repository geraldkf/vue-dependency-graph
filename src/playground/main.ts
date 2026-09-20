import { createPinia, disposePinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
// Pinia does not dispose itself when the app unmounts; do it here so the
// store-owned graph runtime is disposed with the app.
app.onUnmount(() => disposePinia(pinia));
app.mount("#app");
