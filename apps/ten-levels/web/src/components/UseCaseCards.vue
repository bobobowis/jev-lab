<script setup lang="ts">
/** badges: an option's support in the current harness, shown when it isn't full. */
defineProps<{ cases: [string, string][]; selected: string; badges?: Record<string, string> }>();
const emit = defineEmits<{ select: [key: string] }>();
const letter = (i: number) => String.fromCharCode(65 + i);
</script>

<template>
  <div class="cases">
    <button
      v-for="([name, blurb], i) in cases"
      :key="name"
      class="case"
      :class="[{ selected: letter(i) === selected }, badges?.[letter(i)]]"
      @click="emit('select', letter(i))"
    >
      <div class="case-head"><b>{{ letter(i) }}</b> {{ name }}<span v-if="badges?.[letter(i)]" class="case-badge">{{ badges[letter(i)] }}</span></div>
      <p>{{ blurb }}</p>
    </button>
  </div>
</template>
