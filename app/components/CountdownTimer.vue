<script setup>
const {
  parts,
  syncNow,
} = useCountdownSync()
</script>

<template>
  <section class="countdown-card">
    <div class="countdown-grid">
      <div class="countdown-item">
        <span class="countdown-value">{{ parts.days.toString().padStart(2, '0') }}</span>
        <span class="countdown-label">Days</span>
      </div>
      <div class="countdown-item">
        <span class="countdown-value">{{ parts.hours.toString().padStart(2, '0') }}</span>
        <span class="countdown-label">Hours</span>
      </div>
      <div class="countdown-item">
        <span class="countdown-value">{{ parts.minutes.toString().padStart(2, '0') }}</span>
        <span class="countdown-label">Minutes</span>
      </div>
      <div class="countdown-item">
        <span class="countdown-value">{{ parts.seconds.toString().padStart(2, '0') }}</span>
        <span class="countdown-label">Seconds</span>
      </div>
    </div>
    <div @click="syncNow">
      重置
    </div>
  </section>
</template>

<style scoped>
.countdown-card {
  @apply rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 p-6 shadow-sm backdrop-blur;
}

.countdown-grid {
  @apply grid grid-cols-2 sm:grid-cols-4 gap-4;
}

.countdown-item {
  @apply flex flex-col items-center justify-center;
}

.countdown-value {
  @apply text-4xl font-semibold text-primary-500 tabular-nums;
}

.countdown-label {
  @apply mt-1 text-xs uppercase tracking-[0.2em] text-gray-500;
}

.countdown-status {
  @apply mt-5 text-center text-sm text-gray-600 dark:text-gray-300;
}

.countdown-meta {
  @apply mt-4 flex flex-col items-center gap-3 text-sm text-gray-500 sm:flex-row sm:justify-between;
}

.meta-item {
  @apply text-gray-600 dark:text-gray-300;
}

.meta-button {
  @apply rounded-lg border border-primary-500 px-3 py-2 text-sm font-medium text-primary-600 transition hover:bg-primary-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60;
}
</style>
