import { ref } from 'vue';
import { defineStore } from 'pinia';
import {
  apiErrorMessage,
  confirmGuests,
  createDiscussion,
  generateGuests,
  getDiscussion,
  listDiscussions,
  startDiscussion,
} from '../api/client';
import type { DiscussionDetail, DiscussionSummary } from '../api/types';

/**
 * 首页 / 阵容确认页的数据源（SESSION_MAP §S8）。
 *
 * 只做「请求 + 状态」：payload 保持 snake_case，不做 camel↔snake 映射层。
 * 唯一的中转在请求边界：表单的 `expertCount` 是 UI 命名，进 `createDiscussion`
 * 时才写成 `expert_count`（AGENTS §6.10 允许的唯一一处边界转换）。
 *
 * 失败时**不回落假数据**（AGENTS §7）：`error` 带上服务端 message，视图就地展示。
 */
export const useHomeStore = defineStore('home', () => {
  const list = ref<DiscussionSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const busy = ref(false);
  const detail = ref<DiscussionDetail | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      list.value = await listDiscussions();
    } catch (caught) {
      error.value = apiErrorMessage(caught);
    } finally {
      loading.value = false;
    }
  }

  /** create → generate；返回新讨论 id，失败返回 null 并写 `error`。 */
  async function create(input: { topic: string; expertCount: number }): Promise<number | null> {
    busy.value = true;
    error.value = null;
    try {
      const created = await createDiscussion({
        topic: input.topic,
        expert_count: input.expertCount,
      });
      await generateGuests(created.id);
      return created.id;
    } catch (caught) {
      error.value = apiErrorMessage(caught);
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function fetchDetail(id: number): Promise<boolean> {
    busy.value = true;
    error.value = null;
    detail.value = null;
    try {
      detail.value = await getDiscussion(id);
      return true;
    } catch (caught) {
      error.value = apiErrorMessage(caught);
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** 确认前重新生成阵容：服务端会先删旧的 locked=0 行。 */
  async function regenerate(id: number): Promise<boolean> {
    busy.value = true;
    error.value = null;
    try {
      await generateGuests(id);
      return true;
    } catch (caught) {
      error.value = apiErrorMessage(caught);
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** 锁定阵容（confirm）。**不启动**——start 单独一步，避免 start 失败后重试又撞 409。 */
  async function confirmRoster(id: number): Promise<boolean> {
    busy.value = true;
    error.value = null;
    try {
      await confirmGuests(id);
      return true;
    } catch (caught) {
      error.value = apiErrorMessage(caught);
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** ready → running。可单独重试：confirm 已成功、只是 start 失败时不会再锁一次。 */
  async function start(id: number): Promise<boolean> {
    busy.value = true;
    error.value = null;
    try {
      await startDiscussion(id);
      return true;
    } catch (caught) {
      error.value = apiErrorMessage(caught);
      return false;
    } finally {
      busy.value = false;
    }
  }

  return {
    list,
    loading,
    error,
    busy,
    detail,
    load,
    create,
    fetchDetail,
    regenerate,
    confirmRoster,
    start,
  };
});
