<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { fetchLevel, type LevelPayload } from "../lib/api";
import { LEVELS, USE_CASES, USE_LABEL, splitUse } from "../lib/levels";
import { reveal } from "../lib/store";
import { loadHarnesses, supportFor } from "../lib/harness";
import LevelProgress from "../components/LevelProgress.vue";
import UseCaseCards from "../components/UseCaseCards.vue";
import LiveExample from "../components/LiveExample.vue";

const props = defineProps<{ n: number }>();

const meta = computed(() => LEVELS.find((l) => l.n === props.n)!);
const payload = ref<LevelPayload | null>(null);
const selected = ref("A");
const option = computed(() => payload.value?.options.find((o) => o.key === selected.value) ?? null);
/** Agent levels: degraded or unavailable in the picked harness, per option. */
const badges = computed(() => Object.fromEntries((payload.value?.agent ? payload.value.options : [])
  .map((o) => [o.key, supportFor(o).status]).filter(([, s]) => s !== "full")));
const prev = computed(() => LEVELS.find((l) => l.n === props.n - 1));

watch(
  () => props.n,
  async (n) => {
    reveal(n);
    selected.value = "A";
    payload.value = null;
    payload.value = await fetchLevel(n);
    if (payload.value.agent) loadHarnesses();
  },
  { immediate: true },
);
</script>

<template>
  <div class="wrap">
    <div class="pagehead">
      <div class="lvl">Level {{ n }}</div>
      <LevelProgress :n="n" />
      <h1>{{ meta.title }}</h1>
      <div class="sub">{{ splitUse(meta.sub)[0] }}<span class="use-label">{{ USE_LABEL }}</span>{{ splitUse(meta.sub)[1] }}</div>
    </div>
    <div class="hero"><img :src="`/heroes/level-${n}.svg`" :alt="meta.title" /></div>

    <div class="section-head"><h2>Use Cases</h2><span class="meta">Pick one to load it below</span></div>
    <UseCaseCards :cases="USE_CASES[n]" :selected="selected" :badges="badges" @select="selected = $event" />

    <LiveExample v-if="option" :n="n" :option="option" :agent="payload?.agent" />
    <div v-else class="meta">Loading the example ...</div>

    <div class="pagenav example-wrap">
      <RouterLink v-if="prev" :to="`/level/${prev.n}`">Previous level: {{ prev.title }}</RouterLink>
      <span v-else class="off">Previous level</span>
      <RouterLink to="/">Next Level</RouterLink>
    </div>
  </div>
</template>
