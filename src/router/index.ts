import { createRouter, createWebHistory } from 'vue-router'
import DispatchPage from '../views/DispatchPage.vue'
import LayoutPage from '../views/LayoutPage.vue'
import PrintPage from '../views/PrintPage.vue'
import SpecimensPage from '../views/SpecimensPage.vue'
import TemplatesPage from '../views/TemplatesPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/layout' },
    { path: '/layout', component: LayoutPage },
    { path: '/specimens', component: SpecimensPage },
    { path: '/print', component: PrintPage },
    { path: '/dispatch', component: DispatchPage },
    { path: '/templates', component: TemplatesPage },
  ],
})
