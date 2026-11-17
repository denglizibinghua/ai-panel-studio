import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

/**
 * 三个页面（docs/SESSION_MAP.md §S7）：首页、确认阵容、演播厅。
 * 视图懒加载，壳与路由表保持轻量。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/discussions/:id/guests',
    name: 'guest-confirm',
    component: () => import('../views/GuestConfirmView.vue'),
    props: true,
  },
  {
    path: '/discussions/:id/theater',
    name: 'theater',
    component: () => import('../views/TheaterView.vue'),
    props: true,
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
