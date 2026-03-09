<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const isMobileMenuOpen = ref(false)
const typedCode = ref('')
const showCodeCaret = ref(false)
const currentPath = ref(typeof window !== 'undefined' ? window.location.pathname : '/')
const isLeaderboardPage = computed(() => /^\/leaderboard\/?$/.test(currentPath.value))
const isMilestonesPage = computed(() => /^\/milestones\/?$/.test(currentPath.value))
const fullCode = 'Hillbro97'
const SUBTITLE_REVEAL_MS = 1020
const leaderboardTimerTitle = ref('Leaderboard ends in')
const leaderboardCountdown = ref({
  days: '00',
  hours: '00',
  minutes: '00',
  seconds: '00',
})
const leaderboardRewardByRank = {
  1: '$100',
  2: '$70',
  3: '$50',
  4: '$30',
  5: '$20',
  6: '$15',
  7: '$10',
  8: '$5',
  9: '$0',
  10: '$0',
}
const LEADERBOARD_CACHE_KEY = 'hillrewards.leaderboard.rows.v1'
const leaderboardRows = ref(createDefaultLeaderboardRows())
const leaderboardTopRows = computed(() => {
  const top = leaderboardRows.value.filter((row) => row.rank <= 3)
  const r1 = top.find((row) => row.rank === 1)
  const r2 = top.find((row) => row.rank === 2)
  const r3 = top.find((row) => row.rank === 3)
  return [r2, r1, r3].filter(Boolean)
})
const leaderboardTableRows = computed(() => leaderboardRows.value.filter((row) => row.rank >= 4 && row.rank <= 10))
const leaderboardRulesRef = ref(null)
const promoFlipActive = ref(false)
const milestoneCards = [
  { goal: '$5,000', reward: '$10', tier: 'base' },
  { goal: '$10,000', reward: '$12', tier: 'base' },
  { goal: '$15,000', reward: '$15', tier: 'base' },
  { goal: '$20,000', reward: '$18', tier: 'base' },
  { goal: '$35,000', reward: '$25', tier: 'gold' },
  { goal: '$50,000', reward: '$35', tier: 'gold' },
  { goal: '$75,000', reward: '$60', tier: 'gold' },
  { goal: '$100,000', reward: '$80', tier: 'vip' },
  { goal: '$150,000', reward: '$90', tier: 'vip' },
  { goal: '$200,000', reward: '$110', tier: 'vip' },
  { goal: '$300,000', reward: '$150', tier: 'vip' },
  { goal: '$500,000', reward: '$300', tier: 'vip' },
  { goal: '$1,000,000', reward: '$1,000', tier: 'teal' },
  { goal: '$2,500,000', reward: '$1,800', tier: 'teal' },
  { goal: '$5,000,000', reward: '$4,000', tier: 'teal' },
]

let typingStartTimeout = null
let typingInterval = null
let previousScrollRestoration = null
let onPopstate = null
let leaderboardCountdownInterval = null
let leaderboardRefreshInterval = null
let leaderboardFetchPromise = null
let activeLeaderboardPeriodKey = getLeaderboardPeriod().key

function createDefaultLeaderboardRows() {
  return Array.from({ length: 10 }, (_, index) => {
    const rank = index + 1
    return {
      rank,
      name: '',
      wager: '$0',
      reward: leaderboardRewardByRank[rank] || '$0',
    }
  })
}

function getLeaderboardPeriod(baseDate = new Date()) {
  const current = new Date(baseDate)
  const startOfMonth = new Date(current.getFullYear(), current.getMonth(), 1, 0, 0, 0, 0)
  const startOfNextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1, 0, 0, 0, 0)

  return {
    key: `${startOfMonth.getFullYear()}-${String(startOfMonth.getMonth() + 1).padStart(2, '0')}`,
    startDateIso: startOfMonth.toISOString(),
    endDateIso: current.toISOString(),
    countdownEndsAt: startOfNextMonth.getTime(),
  }
}

function formatUsd(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return '$0'
  }
  return `$${numeric.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

function parseWagerValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '')
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function normalizeLeaderboardPayload(payload) {
  const directArray = Array.isArray(payload)
    ? payload
    : payload?.leaderboard ||
      payload?.rows ||
      payload?.items ||
      payload?.data?.leaderboard ||
      payload?.data?.rows ||
      payload?.data?.items ||
      payload?.data

  if (!Array.isArray(directArray)) {
    return []
  }

  const normalized = directArray
    .map((entry, index) => {
      const rankCandidate = Number(entry?.rank ?? entry?.position ?? entry?.place ?? 0)
      const rank = Number.isInteger(rankCandidate) && rankCandidate > 0 ? rankCandidate : index + 1
      const name =
        String(entry?.username || entry?.name || entry?.player || entry?.nickname || entry?.user || '').trim() || ''
      const wagerRaw =
        entry?.wager ??
        entry?.wagered ??
        entry?.wagerAmount ??
        entry?.totalWager ??
        entry?.wager_total ??
        entry?.volume ??
        0
      const wagerValue = parseWagerValue(wagerRaw)

      return { rank, name, wagerValue }
    })
    .filter((entry) => entry.rank >= 1 && entry.rank <= 10)

  if (!normalized.length) {
    return []
  }

  const hasExplicitRank = normalized.some((entry) => Number.isInteger(entry.rank) && entry.rank > 0)
  if (hasExplicitRank) {
    return normalized.sort((a, b) => a.rank - b.rank).slice(0, 10)
  }

  return normalized.sort((a, b) => b.wagerValue - a.wagerValue).slice(0, 10)
}

function applyLeaderboardRows(apiRows) {
  const nextRows = createDefaultLeaderboardRows()
  for (const apiRow of apiRows) {
    if (!apiRow || apiRow.rank < 1 || apiRow.rank > 10) {
      continue
    }

    nextRows[apiRow.rank - 1] = {
      rank: apiRow.rank,
      name: apiRow.name,
      wager: formatUsd(apiRow.wagerValue),
      reward: leaderboardRewardByRank[apiRow.rank] || '$0',
    }
  }

  leaderboardRows.value = nextRows
}

function clearLeaderboardCache() {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.removeItem(LEADERBOARD_CACHE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function syncLeaderboardPeriod() {
  const period = getLeaderboardPeriod()
  const changed = period.key !== activeLeaderboardPeriodKey
  if (changed) {
    activeLeaderboardPeriodKey = period.key
    leaderboardRows.value = createDefaultLeaderboardRows()
    clearLeaderboardCache()
  }
  return { period, changed }
}

function cacheLeaderboardRows(apiRows) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(
      LEADERBOARD_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        periodKey: activeLeaderboardPeriodKey,
        rows: apiRows,
      }),
    )
  } catch {
    // Ignore storage failures.
  }
}

function applyCachedLeaderboardRows() {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_CACHE_KEY)
    if (!raw) {
      return
    }
    const parsed = JSON.parse(raw)
    if (parsed?.periodKey !== activeLeaderboardPeriodKey) {
      clearLeaderboardCache()
      return
    }
    const cachedRows = Array.isArray(parsed?.rows) ? parsed.rows : []
    if (!cachedRows.length) {
      return
    }
    applyLeaderboardRows(cachedRows)
  } catch {
    // Ignore malformed cache.
  }
}

async function fetchLeaderboardRows() {
  if (leaderboardFetchPromise) {
    await leaderboardFetchPromise
    return
  }

  leaderboardFetchPromise = (async () => {
    const { period } = syncLeaderboardPeriod()
    const requestPeriodKey = period.key

    try {
      const monthlyResponse = await fetch(
        `/api/lb?startDate=${encodeURIComponent(period.startDateIso)}&endDate=${encodeURIComponent(period.endDateIso)}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!monthlyResponse.ok) {
        return
      }

      const monthlyPayload = await monthlyResponse.json()
      const monthlyRows = normalizeLeaderboardPayload(monthlyPayload)
      if (monthlyRows.length) {
        if (requestPeriodKey !== activeLeaderboardPeriodKey) {
          return
        }
        applyLeaderboardRows(monthlyRows)
        cacheLeaderboardRows(monthlyRows)
        return
      }

      const fallbackResponse = await fetch('/api/lb', { headers: { Accept: 'application/json' } })
      if (!fallbackResponse.ok) {
        return
      }

      const fallbackPayload = await fallbackResponse.json()
      const fallbackRows = normalizeLeaderboardPayload(fallbackPayload)
      if (!fallbackRows.length) {
        return
      }
      if (requestPeriodKey !== activeLeaderboardPeriodKey) {
        return
      }

      applyLeaderboardRows(fallbackRows)
      cacheLeaderboardRows(fallbackRows)
    } catch {
      // Keep defaults on network errors.
    }
  })()

  try {
    await leaderboardFetchPromise
  } finally {
    leaderboardFetchPromise = null
  }
}

function triggerLeaderboardFetch() {
  void fetchLeaderboardRows()
}

function toggleMobileMenu() {
  isMobileMenuOpen.value = !isMobileMenuOpen.value
}

function togglePromoFlip() {
  promoFlipActive.value = !promoFlipActive.value
}

function navigateTo(path) {
  if (typeof window === 'undefined') {
    return
  }

  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path)
    currentPath.value = window.location.pathname
    if (/^\/leaderboard\/?$/.test(path)) {
      triggerLeaderboardFetch()
    }
  }

  window.scrollTo(0, 0)
}

async function scrollToLeaderboardRules() {
  if (typeof window === 'undefined') {
    return
  }

  if (!isLeaderboardPage.value) {
    navigateTo('/leaderboard')
    await nextTick()
  }

  const target = leaderboardRulesRef.value
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function updateLeaderboardCountdown() {
  const { period, changed } = syncLeaderboardPeriod()
  if (changed && isLeaderboardPage.value) {
    triggerLeaderboardFetch()
  }

  const now = Date.now()
  const target = period.countdownEndsAt
  const diff = Math.max(target - now, 0)

  leaderboardTimerTitle.value = 'Leaderboard ends in'

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24)
  const minutes = Math.floor((diff / (1000 * 60)) % 60)
  const seconds = Math.floor((diff / 1000) % 60)

  leaderboardCountdown.value = {
    days: String(days).padStart(2, '0'),
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  }
}

onMounted(() => {
  onPopstate = () => {
    currentPath.value = window.location.pathname
    if (/^\/leaderboard\/?$/.test(currentPath.value)) {
      triggerLeaderboardFetch()
    }
  }

  if (typeof window !== 'undefined') {
    currentPath.value = window.location.pathname
    window.addEventListener('popstate', onPopstate)

    if ('scrollRestoration' in window.history) {
      previousScrollRestoration = window.history.scrollRestoration
      window.history.scrollRestoration = 'manual'
    }

    requestAnimationFrame(() => {
      window.scrollTo(0, 0)
    })

    setTimeout(() => {
      window.scrollTo(0, 0)
    }, 140)
  }

  typingStartTimeout = setTimeout(() => {
    showCodeCaret.value = true
    let index = 0
    typingInterval = setInterval(() => {
      if (index >= fullCode.length) {
        clearInterval(typingInterval)
        showCodeCaret.value = false
        return
      }

      typedCode.value += fullCode[index]
      index += 1
    }, 95)
  }, SUBTITLE_REVEAL_MS)

  updateLeaderboardCountdown()
  leaderboardCountdownInterval = setInterval(updateLeaderboardCountdown, 1000)
  applyCachedLeaderboardRows()
  triggerLeaderboardFetch()
  leaderboardRefreshInterval = setInterval(fetchLeaderboardRows, 60_000)
})

if (typeof window !== 'undefined' && /^\/leaderboard\/?$/.test(window.location.pathname)) {
  triggerLeaderboardFetch()
}

onBeforeUnmount(() => {
  if (typingStartTimeout) {
    clearTimeout(typingStartTimeout)
  }
  if (typingInterval) {
    clearInterval(typingInterval)
  }
  if (leaderboardCountdownInterval) {
    clearInterval(leaderboardCountdownInterval)
  }
  if (leaderboardRefreshInterval) {
    clearInterval(leaderboardRefreshInterval)
  }

  if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
    window.history.scrollRestoration = previousScrollRestoration ?? 'auto'
  }

  if (typeof window !== 'undefined' && onPopstate) {
    window.removeEventListener('popstate', onPopstate)
  }
})
</script>

<template>
  <main v-if="isLeaderboardPage" class="leaderboard-page" aria-label="Leaderboard page">
    <nav class="top-nav" aria-label="Primary navigation">
      <div class="top-nav__inner">
        <div class="nav-cluster">
          <a class="brand-mark" href="/" aria-label="Hill Rewards home">
            <img class="brand-mark__image" src="/images/logo.png" alt="Hill Rewards" />
          </a>

          <a class="nav-tab" href="/leaderboard" aria-label="Leaderboards">
            <span>Leaderboard</span>
          </a>

          <a class="nav-tab nav-tab--milestones" href="/milestones" aria-label="Milestones">
            <span>Milestones</span>
          </a>

          <button
            class="mobile-menu-btn"
            :class="{ 'mobile-menu-btn--open': isMobileMenuOpen }"
            type="button"
            :aria-label="isMobileMenuOpen ? 'Close menu' : 'Open menu'"
            :aria-expanded="isMobileMenuOpen"
            aria-controls="mobile-nav-menu"
            @click="toggleMobileMenu"
          >
            <span class="mobile-menu-btn__bar"></span>
            <span class="mobile-menu-btn__bar"></span>
            <span class="mobile-menu-btn__bar"></span>
          </button>
        </div>
      </div>
    </nav>

    <transition name="mobile-menu-fade" appear>
      <section
        v-if="isMobileMenuOpen"
        id="mobile-nav-menu"
        class="mobile-menu"
        aria-label="Mobile navigation"
      >
        <a class="mobile-nav-tab mobile-nav-tab--leaderboard" href="/leaderboard">
          <span>Leaderboard</span>
        </a>
        <a class="mobile-nav-tab mobile-nav-tab--milestones" href="/milestones">
          <span>Milestones</span>
        </a>
      </section>
    </transition>

    <section class="hero hero--leaderboard" aria-label="Leaderboard hero">
      <h1 class="hero__title">
        <span class="hero__title-top" data-text="$300 MONTHLY">$300 MONTHLY</span>
        <span class="hero__title-bottom" data-text="LEADERBOARD">LEADERBOARD</span>
      </h1>
      <p class="hero__subtitle">
        Wager under code <span class="hero__code">Hillbro97</span> and climb to the top of the Leaderboard!
      </p>
      <div class="hero__actions" aria-label="Primary actions">
        <a class="hero-cta hero-cta--primary" href="https://roobet.com/?ref=hillbro97">
          <span>Code: Hillbro97</span>
        </a>
        <a class="hero-cta hero-cta--secondary" href="#leaderboard-rules" @click.prevent="scrollToLeaderboardRules">
          <span>Leaderboard Rules</span>
        </a>
      </div>
      <section class="leaderboard-timer" aria-label="Leaderboard countdown">
        <h2 class="leaderboard-timer__title">{{ leaderboardTimerTitle }}</h2>
        <div class="leaderboard-timer__grid">
          <div class="leaderboard-timer__unit">
            <strong>{{ leaderboardCountdown.days }}</strong>
            <span>Days</span>
          </div>
          <div class="leaderboard-timer__unit">
            <strong>{{ leaderboardCountdown.hours }}</strong>
            <span>Hrs</span>
          </div>
          <div class="leaderboard-timer__unit">
            <strong>{{ leaderboardCountdown.minutes }}</strong>
            <span>Min</span>
          </div>
          <div class="leaderboard-timer__unit">
            <strong>{{ leaderboardCountdown.seconds }}</strong>
            <span>Sec</span>
          </div>
        </div>
      </section>
      <div class="hero__triangles" aria-hidden="true">
        <span class="hero-triangle"></span>
        <span class="hero-triangle hero-triangle--active"></span>
        <span class="hero-triangle"></span>
      </div>
      <section class="leaderboard-throne" aria-label="Top 3 leaderboard">
        <article
          v-for="row in leaderboardTopRows"
          :key="`top-${row.rank}`"
          class="leaderboard-throne__card"
          :class="`leaderboard-throne__card--${row.rank}`"
        >
          <div class="leaderboard-throne__badge">#{{ row.rank }}</div>
          <div class="leaderboard-throne__name" :title="row.name || ''">{{ row.name || '\u00A0' }}</div>
          <div class="leaderboard-throne__meta">
            <span class="leaderboard-throne__meta-label">Wagered</span>
            <strong class="leaderboard-throne__meta-value">{{ row.wager }}</strong>
          </div>
          <div class="leaderboard-throne__meta">
            <span class="leaderboard-throne__meta-label">Reward</span>
            <strong class="leaderboard-throne__meta-value">{{ row.reward }}</strong>
          </div>
        </article>
      </section>

      <section class="leaderboard-panel" aria-label="Leaderboard standings 4 to 10">
        <header class="leaderboard-panel__head">
          <span>Rank</span>
          <span>Player</span>
          <span>Wagered</span>
          <span>Reward</span>
        </header>
        <article v-for="row in leaderboardTableRows" :key="row.rank" class="leaderboard-panel__row">
          <span class="leaderboard-panel__rank">#{{ row.rank }}</span>
          <span class="leaderboard-panel__name">{{ row.name || '\u00A0' }}</span>
          <span>{{ row.wager }}</span>
          <span>{{ row.reward }}</span>
        </article>
      </section>
      <section id="leaderboard-rules" ref="leaderboardRulesRef" class="leaderboard-rules" aria-label="Leaderboard rules">
        <h3 class="leaderboard-rules__title">Wager Contribution Rules</h3>
        <p class="leaderboard-rules__text">
          This leaderboard uses a contribution model where different RTP ranges count differently toward total
          wager.
        </p>
        <ul class="leaderboard-rules__list">
          <li>Games with RTP from 0.01% to 1.49% contribute <strong>20%</strong>.</li>
          <li>Games with RTP above 1.49% contribute <strong>100%</strong>.</li>
        </ul>
      </section>
      <div class="leaderboard-after-space" aria-hidden="true"></div>
      <div class="footer-divider" aria-hidden="true"></div>
      <footer class="site-footer" aria-label="Site footer">
        <div class="site-footer__inner">
          <div class="site-footer__brand">
            <div class="site-footer__head">
              <img class="site-footer__logo" src="/images/logo.png" alt="Hill Rewards" />
              <div class="site-footer__title">HILL REWARDS</div>
            </div>
            <a
              class="site-footer__copy"
              href="https://discordapp.com/users/1472655247725039729"
              target="_blank"
              rel="noopener noreferrer"
            >
              &copy; 2026 hillrewards.com | Created by @vibac
            </a>
          </div>
          <nav class="site-footer__nav" aria-label="Footer navigation">
            <h3 class="site-footer__col-title">Navigate</h3>
            <a class="site-footer__nav-link" href="/">Home</a>
            <a class="site-footer__nav-link" href="/leaderboard">Leaderboard</a>
            <a class="site-footer__nav-link" href="/milestones">Milestones</a>
          </nav>
          <div class="site-footer__connect" aria-label="Social links">
            <h3 class="site-footer__col-title">Connect</h3>
            <div class="site-footer__socials">
              <a
                class="site-footer__social"
                href="https://roobet.com/?ref=hillbro97"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Roobet"
              >
                <img class="site-footer__social-icon" src="/images/roobetlogo.png" alt="" />
              </a>
              <a
                class="site-footer__social"
                href="https://discord.gg/hVJjrr4gcN"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Discord"
              >
                <img class="site-footer__social-icon" src="/images/discord.svg" alt="" />
              </a>
              <a
                class="site-footer__social"
                href="https://kick.com/hillbro97"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Kick"
              >
                <img class="site-footer__social-icon" src="/images/kick.webp" alt="" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </section>
  </main>
  <main v-else-if="isMilestonesPage" class="milestones-page" aria-label="Milestones page">
    <nav class="top-nav" aria-label="Primary navigation">
      <div class="top-nav__inner">
        <div class="nav-cluster">
          <a class="brand-mark" href="/" aria-label="Hill Rewards home">
            <img class="brand-mark__image" src="/images/logo.png" alt="Hill Rewards" />
          </a>

          <a class="nav-tab" href="/leaderboard" aria-label="Leaderboards">
            <span>Leaderboard</span>
          </a>

          <a class="nav-tab nav-tab--milestones" href="/milestones" aria-label="Milestones">
            <span>Milestones</span>
          </a>

          <button
            class="mobile-menu-btn"
            :class="{ 'mobile-menu-btn--open': isMobileMenuOpen }"
            type="button"
            :aria-label="isMobileMenuOpen ? 'Close menu' : 'Open menu'"
            :aria-expanded="isMobileMenuOpen"
            aria-controls="mobile-nav-menu"
            @click="toggleMobileMenu"
          >
            <span class="mobile-menu-btn__bar"></span>
            <span class="mobile-menu-btn__bar"></span>
            <span class="mobile-menu-btn__bar"></span>
          </button>
        </div>
      </div>
    </nav>

    <transition name="mobile-menu-fade" appear>
      <section
        v-if="isMobileMenuOpen"
        id="mobile-nav-menu"
        class="mobile-menu"
        aria-label="Mobile navigation"
      >
        <a class="mobile-nav-tab mobile-nav-tab--leaderboard" href="/leaderboard">
          <span>Leaderboard</span>
        </a>
        <a class="mobile-nav-tab mobile-nav-tab--milestones" href="/milestones">
          <span>Milestones</span>
        </a>
      </section>
    </transition>

    <section class="hero hero--milestones" aria-label="Hillbro rewards intro">
      <div class="hero__left-decor-wrap" aria-hidden="true">
        <img class="hero__left-decor" src="/images/rainbow.png" alt="" />
      </div>
      <div class="hero__right-decor-wrap" aria-hidden="true">
        <img class="hero__right-decor hero__right-decor--retro" src="/images/retro.png" alt="" />
      </div>
      <h1 class="hero__title">
        <span class="hero__title-top" data-text="RANK">RANK</span>
        <span class="hero__title-bottom" data-text="MILESTONES">MILESTONES</span>
      </h1>
      <p class="hero__subtitle">
        Wager under code <span class="hero__code">Hillbro97</span> and hit the wager targets to unlock rewards.
      </p>
      <div class="hero__triangles" aria-hidden="true">
        <span class="hero-triangle"></span>
        <span class="hero-triangle hero-triangle--active"></span>
        <span class="hero-triangle"></span>
      </div>

      <section class="milestones-board" aria-label="Milestone rewards">
        <article
          v-for="card in milestoneCards"
          :key="card.goal"
          class="milestone-card"
          :class="[
            card.tier === 'gold' ? 'milestone-card--gold' : '',
            card.tier === 'vip' ? 'milestone-card--vip' : '',
            card.tier === 'teal' ? 'milestone-card--teal' : '',
          ]"
        >
          <div class="milestone-card__label">Wager Goal</div>
          <div class="milestone-card__goal">{{ card.goal }}</div>
          <div class="milestone-card__divider"></div>
          <div class="milestone-card__label">Reward</div>
          <div class="milestone-card__reward">{{ card.reward }}</div>
          <a
            class="milestone-card__cta"
            href="https://discord.com/invite/hVJjrr4gcN"
            target="_blank"
            rel="noopener noreferrer"
          >
            Claim Reward
          </a>
        </article>
      </section>

      <div class="footer-decor footer-decor--left" aria-hidden="true">
        <img class="footer-decor__image footer-decor__image--weapon" src="/images/scatter.png" alt="" />
      </div>
      <div class="footer-decor footer-decor--right" aria-hidden="true">
        <img class="footer-decor__image footer-decor__image--candy" src="/images/sweetb.png" alt="" />
      </div>
      <div class="footer-divider" aria-hidden="true"></div>
      <footer class="site-footer" aria-label="Site footer">
        <div class="site-footer__inner">
          <div class="site-footer__brand">
            <div class="site-footer__head">
              <img class="site-footer__logo" src="/images/logo.png" alt="Hill Rewards" />
              <div class="site-footer__title">HILL REWARDS</div>
            </div>
            <a
              class="site-footer__copy"
              href="https://discordapp.com/users/1472655247725039729"
              target="_blank"
              rel="noopener noreferrer"
            >
              &copy; 2026 hillrewards.com | Created by @vibac
            </a>
          </div>
          <nav class="site-footer__nav" aria-label="Footer navigation">
            <h3 class="site-footer__col-title">Navigate</h3>
            <a class="site-footer__nav-link" href="/">Home</a>
            <a class="site-footer__nav-link" href="/leaderboard">Leaderboard</a>
            <a class="site-footer__nav-link" href="/milestones">Milestones</a>
          </nav>
          <div class="site-footer__connect" aria-label="Social links">
            <h3 class="site-footer__col-title">Connect</h3>
            <div class="site-footer__socials">
              <a
                class="site-footer__social"
                href="https://roobet.com/?ref=hillbro97"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Roobet"
              >
                <img class="site-footer__social-icon" src="/images/roobetlogo.png" alt="" />
              </a>
              <a
                class="site-footer__social"
                href="https://discord.gg/hVJjrr4gcN"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Discord"
              >
                <img class="site-footer__social-icon" src="/images/discord.svg" alt="" />
              </a>
              <a
                class="site-footer__social"
                href="https://kick.com/hillbro97"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Kick"
              >
                <img class="site-footer__social-icon" src="/images/kick.webp" alt="" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </section>
  </main>
  <main v-else class="home-page">
    <nav class="top-nav" aria-label="Primary navigation">
      <div class="top-nav__inner">
        <div class="nav-cluster">
          <a class="brand-mark" href="/" aria-label="Hill Rewards home">
            <img class="brand-mark__image" src="/images/logo.png" alt="Hill Rewards" />
          </a>

          <a class="nav-tab" href="/leaderboard" aria-label="Leaderboards">
            <span>Leaderboard</span>
          </a>

          <a class="nav-tab nav-tab--milestones" href="/milestones" aria-label="Milestones">
            <span>Milestones</span>
          </a>

          <button
            class="mobile-menu-btn"
            :class="{ 'mobile-menu-btn--open': isMobileMenuOpen }"
            type="button"
            :aria-label="isMobileMenuOpen ? 'Close menu' : 'Open menu'"
            :aria-expanded="isMobileMenuOpen"
            aria-controls="mobile-nav-menu"
            @click="toggleMobileMenu"
          >
            <span class="mobile-menu-btn__bar"></span>
            <span class="mobile-menu-btn__bar"></span>
            <span class="mobile-menu-btn__bar"></span>
          </button>
        </div>
      </div>
    </nav>

    <transition name="mobile-menu-fade" appear>
      <section
        v-if="isMobileMenuOpen"
        id="mobile-nav-menu"
        class="mobile-menu"
        aria-label="Mobile navigation"
      >
        <a class="mobile-nav-tab mobile-nav-tab--leaderboard" href="/leaderboard">
          <span>Leaderboard</span>
        </a>
        <a class="mobile-nav-tab mobile-nav-tab--milestones" href="/milestones">
          <span>Milestones</span>
        </a>
      </section>
    </transition>

    <section class="hero" aria-label="Hillbro rewards intro">
      <div class="hero__left-decor-wrap" aria-hidden="true">
        <img class="hero__left-decor" src="/images/karambit.png" alt="" />
      </div>
      <div class="hero__right-decor-wrap" aria-hidden="true">
        <img class="hero__right-decor" src="/images/doppler.png" alt="" />
      </div>
      <h1 class="hero__title">
        <span class="hero__title-top" data-text="Hill">Hill</span>
        <span class="hero__title-bottom" data-text="Rewards">Rewards</span>
      </h1>
      <p class="hero__subtitle">
        Exclusive benefits and premium rewards on Roobet with code
        <span class="hero__code-wrap">
          <span class="hero__code">{{ typedCode }}</span>
          <span v-if="showCodeCaret" class="hero__code-caret" aria-hidden="true"></span>
        </span>
      </p>
      <div class="hero__actions" aria-label="Primary actions">
        <a class="hero-cta hero-cta--primary" href="/leaderboard" @click.prevent="navigateTo('/leaderboard')">
          <span>View Leaderboard</span>
        </a>
        <a class="hero-cta hero-cta--secondary" href="/milestones" @click.prevent="navigateTo('/milestones')">
          <span>Claim Rewards</span>
        </a>
      </div>
      <div class="hero__triangles" aria-hidden="true">
        <span class="hero-triangle"></span>
        <span class="hero-triangle hero-triangle--active"></span>
        <span class="hero-triangle"></span>
      </div>
      <a
        class="promo-shell"
        href="https://roobet.com/?ref=hillbro97"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Roobet referral page"
      >
        <button
          class="promo-shell__corner-gift"
          :class="{ 'promo-shell__corner-gift--active': promoFlipActive }"
          type="button"
          aria-label="Toggle promo preview"
          @click.prevent.stop="togglePromoFlip"
        >
          <img src="/images/present.svg" alt="" />
        </button>
        <img
          class="promo-shell__flip-bg"
          :class="{ 'promo-shell__flip-bg--active': promoFlipActive }"
          src="/images/flip-bg.png"
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
        />
        <div class="promo-shell__flip-content" :class="{ 'promo-shell__flip-content--active': promoFlipActive }" aria-hidden="true">
          <h3>Signup Benefits</h3>
          <p>25 free spins when reaching silver 1</p>
          <p>20% commission back</p>
        </div>
        <img
          class="promo-shell__bg"
          src="/images/hillbroroobet.png"
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          fetchpriority="high"
        />
        <img
          class="promo-shell__bg promo-shell__bg--hover"
          src="/images/hillbroroobet2.png"
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
        />
        <div class="promo-shell__stack" :class="{ 'promo-shell__stack--hidden': promoFlipActive }" aria-hidden="true">
          <img class="promo-shell__brand promo-shell__brand--roobet" src="/images/roobet.png" alt="" />
          <span class="promo-shell__x">x</span>
          <img class="promo-shell__brand promo-shell__brand--hillbro" src="/images/logo.png" alt="" />
        </div>
        <span class="promo-shell__mobile-cta" aria-hidden="true">Sign-up</span>
      </a>
      <div class="footer-decor footer-decor--left" aria-hidden="true">
        <img class="footer-decor__image footer-decor__image--weapon" src="/images/vssymb.png" alt="" />
      </div>
      <div class="footer-decor footer-decor--right" aria-hidden="true">
        <img class="footer-decor__image footer-decor__image--candy" src="/images/lolipop.png" alt="" />
      </div>
      <div class="footer-divider" aria-hidden="true"></div>
      <footer class="site-footer" aria-label="Site footer">
        <div class="site-footer__inner">
          <div class="site-footer__brand">
            <div class="site-footer__head">
              <img class="site-footer__logo" src="/images/logo.png" alt="Hill Rewards" />
              <div class="site-footer__title">HILL REWARDS</div>
            </div>
            <a
              class="site-footer__copy"
              href="https://discordapp.com/users/1472655247725039729"
              target="_blank"
              rel="noopener noreferrer"
            >
              &copy; 2026 hillrewards.com | Created by @vibac
            </a>
          </div>
          <nav class="site-footer__nav" aria-label="Footer navigation">
            <h3 class="site-footer__col-title">Navigate</h3>
            <a class="site-footer__nav-link" href="/">Home</a>
            <a class="site-footer__nav-link" href="/leaderboard">Leaderboard</a>
            <a class="site-footer__nav-link" href="/milestones">Milestones</a>
          </nav>
          <div class="site-footer__connect" aria-label="Social links">
            <h3 class="site-footer__col-title">Connect</h3>
            <div class="site-footer__socials">
              <a
                class="site-footer__social"
                href="https://roobet.com/?ref=hillbro97"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Roobet"
              >
                <img class="site-footer__social-icon" src="/images/roobetlogo.png" alt="" />
              </a>
              <a
                class="site-footer__social"
                href="https://discord.gg/hVJjrr4gcN"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Discord"
              >
                <img class="site-footer__social-icon" src="/images/discord.svg" alt="" />
              </a>
              <a
                class="site-footer__social"
                href="https://kick.com/hillbro97"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Kick"
              >
                <img class="site-footer__social-icon" src="/images/kick.webp" alt="" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800;900&family=Outfit:wght@500;600;700;800&display=swap');

.home-page {
  min-height: 100vh;
}

.leaderboard-page {
  min-height: 100vh;
  background: #16131b;
}

.milestones-page {
  min-height: 100vh;
  background: #16131b;
}

.leaderboard-timer {
  margin-top: 34px;
  text-align: center;
  opacity: 0;
  transform: translateY(14px);
  animation: hero-intro-actions 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.52s forwards;
}

.leaderboard-timer__title {
  margin: 0;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1.08rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7f72ad;
}

.leaderboard-timer__grid {
  display: inline-grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.leaderboard-timer__unit {
  position: relative;
  width: 62px;
  height: 66px;
  padding-top: 10px;
  border: 1px solid rgba(136, 111, 179, 0.6);
  clip-path: polygon(50% 100%, 0 76%, 0 0, 100% 0, 100% 76%);
  background: linear-gradient(180deg, rgba(50, 42, 69, 0.85) 0%, rgba(35, 29, 49, 0.85) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.leaderboard-timer__unit strong {
  display: block;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1.9rem;
  font-weight: 900;
  line-height: 1;
  color: #b4a5ff;
}

.leaderboard-timer__unit span {
  display: block;
  margin-top: 3px;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #77699d;
}

.leaderboard-panel {
  width: min(100%, 980px);
  margin: 22px auto 0;
  border: 1px solid rgba(145, 121, 196, 0.58);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(31, 26, 45, 0.9) 0%, rgba(23, 19, 34, 0.9) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 14px 28px rgba(10, 8, 18, 0.3);
  overflow: hidden;
}

.leaderboard-panel__head,
.leaderboard-panel__row {
  display: grid;
  grid-template-columns: 0.7fr 1.6fr 1fr 1fr;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
}

.leaderboard-panel__head {
  height: 52px;
  border-bottom: 1px solid rgba(102, 86, 144, 0.35);
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(132, 119, 171, 0.95);
}

.leaderboard-panel__row {
  height: 62px;
  border-bottom: 1px solid rgba(83, 70, 116, 0.26);
  font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1.02rem;
  font-weight: 700;
  color: #ddd7ef;
}

.leaderboard-panel__row:last-child {
  border-bottom: none;
}

.leaderboard-panel__rank {
  color: #b49aff;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-weight: 800;
}

.leaderboard-panel__name {
  color: rgba(210, 201, 232, 0.9);
}

.leaderboard-after-space {
  height: 84px;
}

.leaderboard-rules {
  display: block;
  width: min(100%, 980px);
  margin: 24px auto 0;
  padding: 18px 20px;
  border: 1px solid rgba(136, 114, 178, 0.62);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(35, 29, 49, 0.9) 0%, rgba(27, 23, 38, 0.9) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 12px 24px rgba(10, 8, 18, 0.24);
  text-align: left;
}

.leaderboard-rules__title {
  margin: 0;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1.02rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #e9e3ff;
}

.leaderboard-rules__text {
  margin: 10px 0 0;
  font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.45;
  color: rgba(179, 167, 210, 0.94);
}

.leaderboard-rules__list {
  margin: 12px 0 0;
  padding-left: 20px;
  font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.55;
  color: rgba(201, 193, 225, 0.95);
}

.leaderboard-rules__list strong {
  color: #bfa6ff;
}

.leaderboard-throne {
  width: min(100%, 980px);
  margin: 46px auto 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 14px;
}

.leaderboard-throne__card {
  position: relative;
  flex: 1 1 0;
  min-height: 156px;
  border: 1px solid rgba(145, 121, 196, 0.58);
  border-radius: 14px 14px 10px 10px;
  background: linear-gradient(180deg, rgba(34, 28, 48, 0.9) 0%, rgba(24, 20, 35, 0.9) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 10px 22px rgba(10, 8, 18, 0.28);
  padding: 14px 14px 12px;
  text-align: center;
  overflow: hidden;
  cursor: pointer;
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.28s ease,
    box-shadow 0.28s ease,
    border-color 0.28s ease;
}

.leaderboard-throne__card::after {
  content: '';
  position: absolute;
  inset: -35% auto -35% -22%;
  width: 24%;
  height: 170%;
  transform: rotate(22deg);
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.28) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s ease;
}

.leaderboard-throne__card:hover {
  transform: translateY(-4px);
  filter: brightness(1.03);
}

.leaderboard-throne__card:hover::after {
  opacity: 1;
  animation: nav-shimmer 1.35s ease;
}

.leaderboard-throne__card--1 {
  min-height: 204px;
  border-color: rgba(245, 204, 97, 0.92);
  background: linear-gradient(180deg, rgba(52, 40, 19, 0.38) 0%, rgba(28, 23, 14, 0.7) 100%);
}

.leaderboard-throne__card--1:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 1px rgba(246, 205, 94, 0.26),
    0 0 24px rgba(238, 194, 67, 0.28),
    0 14px 30px rgba(20, 14, 6, 0.32);
}

.leaderboard-throne__card--2,
.leaderboard-throne__card--3 {
  min-height: 174px;
}

.leaderboard-throne__card--2 {
  border-color: rgba(196, 205, 226, 0.9);
  background: linear-gradient(180deg, rgba(52, 58, 73, 0.38) 0%, rgba(26, 31, 43, 0.72) 100%);
}

.leaderboard-throne__card--2:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 1px rgba(196, 205, 226, 0.24),
    0 0 22px rgba(177, 187, 210, 0.24),
    0 14px 30px rgba(12, 14, 20, 0.3);
}

.leaderboard-throne__card--3 {
  min-height: 162px;
  border-color: rgba(214, 152, 112, 0.9);
  background: linear-gradient(180deg, rgba(69, 43, 30, 0.4) 0%, rgba(39, 27, 21, 0.72) 100%);
}

.leaderboard-throne__card--3:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 1px rgba(210, 146, 108, 0.24),
    0 0 22px rgba(184, 124, 91, 0.24),
    0 14px 30px rgba(20, 12, 8, 0.3);
}

.leaderboard-throne__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(192, 163, 249, 0.5);
  background: rgba(112, 87, 170, 0.25);
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 0.86rem;
  font-weight: 800;
  color: #d7c6ff;
}

.leaderboard-throne__card--1 .leaderboard-throne__badge {
  border-color: rgba(245, 204, 97, 0.76);
  background: rgba(151, 111, 24, 0.35);
  color: #ffe7aa;
}

.leaderboard-throne__card--2 .leaderboard-throne__badge {
  border-color: rgba(196, 205, 226, 0.75);
  background: rgba(103, 113, 136, 0.35);
  color: #e8edf7;
}

.leaderboard-throne__card--3 .leaderboard-throne__badge {
  border-color: rgba(214, 152, 112, 0.76);
  background: rgba(125, 78, 50, 0.35);
  color: #f1d1be;
}

.leaderboard-throne__name {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 16px;
  height: 24px;
  padding: 0 10px;
  border-radius: 8px;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: clamp(0.95rem, 0.84rem + 0.22vw, 1.08rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  color: #f4efff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 0 10px rgba(124, 94, 194, 0.26);
}

.leaderboard-throne__card--1 .leaderboard-throne__name {
  color: #ffe293;
  text-shadow:
    0 0 10px rgba(199, 148, 44, 0.38),
    0 0 20px rgba(166, 117, 22, 0.24);
}

.leaderboard-throne__card--2 .leaderboard-throne__name {
  color: #e4eaf7;
  text-shadow:
    0 0 10px rgba(157, 168, 196, 0.35),
    0 0 20px rgba(124, 136, 166, 0.22);
}

.leaderboard-throne__card--3 .leaderboard-throne__name {
  color: #f1c7ad;
  text-shadow:
    0 0 10px rgba(181, 126, 93, 0.34),
    0 0 20px rgba(145, 97, 69, 0.22);
}

.leaderboard-throne__meta {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(120, 104, 162, 0.38);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(46, 38, 64, 0.8) 0%, rgba(34, 28, 49, 0.8) 100%);
}

.leaderboard-throne__meta-label {
  flex: 0 0 auto;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(148, 132, 189, 0.9);
}

.leaderboard-throne__meta-value {
  min-width: 0;
  flex: 1 1 auto;
  text-align: right;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1rem;
  font-weight: 900;
  line-height: 1;
  color: #daccff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.leaderboard-throne__card--1 .leaderboard-throne__meta {
  border-color: rgba(196, 151, 45, 0.45);
  background: linear-gradient(180deg, rgba(61, 46, 19, 0.75) 0%, rgba(43, 33, 14, 0.75) 100%);
}

.leaderboard-throne__card--1 .leaderboard-throne__meta-value {
  color: #ffe293;
}

.leaderboard-throne__card--2 .leaderboard-throne__meta {
  border-color: rgba(154, 166, 194, 0.46);
  background: linear-gradient(180deg, rgba(48, 54, 68, 0.78) 0%, rgba(34, 39, 50, 0.78) 100%);
}

.leaderboard-throne__card--2 .leaderboard-throne__meta-value {
  color: #e4eaf7;
}

.leaderboard-throne__card--3 .leaderboard-throne__meta {
  border-color: rgba(172, 123, 92, 0.46);
  background: linear-gradient(180deg, rgba(59, 40, 31, 0.78) 0%, rgba(41, 29, 24, 0.78) 100%);
}

.leaderboard-throne__card--3 .leaderboard-throne__meta-value {
  color: #f1c7ad;
}

.hero--leaderboard .hero__title-top {
  white-space: nowrap;
}

.hero--leaderboard {
  width: 100%;
  max-width: none;
  padding-left: 20px;
  padding-right: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.hero--leaderboard .hero__title {
  display: flex;
  width: max-content;
  margin-left: 0;
  margin-right: 0;
  align-items: center;
}

.hero--leaderboard .hero__title-top,
.hero--leaderboard .hero__title-bottom {
  text-align: center;
}

.top-nav {
  position: sticky;
  top: 0;
  z-index: 10;
  min-height: 82px;
  background:
    linear-gradient(180deg, rgba(43, 37, 56, 0.95) 0%, rgba(34, 29, 46, 0.95) 100%);
  border-bottom: 1px solid rgba(126, 99, 158, 0.22);
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.04);
}

.top-nav__inner {
  display: flex;
  align-items: center;
  width: 100%;
  height: 82px;
  margin: 0 auto;
  padding: 0 56px;
}

.nav-cluster {
  display: flex;
  align-items: center;
  width: 100%;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding-top: 1px;
  flex: 0 0 auto;
}

.brand-mark__image {
  display: block;
  height: 100px;
  width: auto;
  object-fit: contain;
}

.nav-tab {
  display: none;
  position: relative;
  align-items: center;
  justify-content: center;
  margin-left: 20px;
  min-width: 186px;
  height: 42px;
  padding: 0 22px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: linear-gradient(180deg, #665389 0%, #584777 52%, #4d3e69 100%);
  color: #fffbf3;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 0.84rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  line-height: 1;
  text-transform: uppercase;
  text-decoration: none;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.36);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.24),
    0 4px 12px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.22s ease,
    box-shadow 0.22s ease;
}

.nav-tab--milestones {
  background: linear-gradient(180deg, #5f7fa6 0%, #506f93 52%, #466384 100%);
}

.nav-tab--rewards {
  background: linear-gradient(180deg, #8a6e4f 0%, #775c43 52%, #684f3a 100%);
}

.mobile-menu-btn {
  display: inline-flex;
  position: relative;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  margin-left: auto;
  width: 42px;
  height: 42px;
  padding: 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(98, 83, 133, 0.45) 0%, rgba(68, 57, 95, 0.45) 100%);
  cursor: pointer;
  transition:
    background 0.22s ease,
    box-shadow 0.22s ease,
    transform 0.22s ease;
}

.mobile-menu-btn__bar {
  position: absolute;
  left: 9px;
  width: calc(100% - 18px);
  height: 2px;
  border-radius: 999px;
  background: rgba(245, 235, 223, 0.92);
  transition:
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.2s ease;
}

.mobile-menu-btn__bar:nth-child(1) {
  top: 13px;
}

.mobile-menu-btn__bar:nth-child(2) {
  top: 20px;
}

.mobile-menu-btn__bar:nth-child(3) {
  top: 27px;
}

.mobile-menu-btn--open {
  background: linear-gradient(180deg, rgba(112, 94, 150, 0.58) 0%, rgba(78, 64, 108, 0.58) 100%);
  box-shadow: 0 6px 14px rgba(20, 11, 32, 0.3);
}

.mobile-menu-btn--open .mobile-menu-btn__bar:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
}

.mobile-menu-btn--open .mobile-menu-btn__bar:nth-child(2) {
  opacity: 0;
  transform: scaleX(0.6);
}

.mobile-menu-btn--open .mobile-menu-btn__bar:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
}

.mobile-menu-btn:focus-visible {
  outline: 2px solid rgba(168, 142, 219, 0.92);
  outline-offset: 2px;
}

.mobile-menu {
  position: fixed;
  top: 102px;
  left: 14px;
  right: 14px;
  z-index: 30;
  padding: 14px;
  border: 1px solid rgba(121, 95, 156, 0.35);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(48, 40, 64, 0.95) 0%, rgba(36, 30, 50, 0.95) 100%);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(2px);
}

.mobile-nav-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 46px;
  margin-bottom: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  color: #fff8ef;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 0.83rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  line-height: 1;
  text-transform: uppercase;
  text-decoration: none;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.32);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.22);
  overflow: hidden;
  transition:
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.2s ease,
    box-shadow 0.2s ease;
}

.mobile-nav-tab:last-child {
  margin-bottom: 0;
}

.mobile-nav-tab::before {
  content: '';
  position: absolute;
  inset: 1px 1px auto;
  height: 48%;
  border-radius: 9px 9px 6px 6px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.13) 0%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
}

.mobile-nav-tab::after {
  content: '';
  position: absolute;
  inset: -35% auto -35% -22%;
  width: 24%;
  height: 170%;
  transform: rotate(22deg);
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.34) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: nav-shimmer 2.8s ease-in-out infinite;
  pointer-events: none;
}

.mobile-nav-tab:hover {
  transform: translateY(-1px);
  filter: brightness(1.08) saturate(1.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2),
    0 8px 18px rgba(20, 11, 32, 0.35);
}

.mobile-nav-tab:active {
  transform: translateY(1px) scale(0.985);
  filter: brightness(0.98);
}

.mobile-nav-tab:focus-visible {
  outline: 2px solid rgba(168, 142, 219, 0.92);
  outline-offset: 2px;
}

.mobile-nav-tab--leaderboard {
  background: linear-gradient(180deg, #665389 0%, #584777 52%, #4d3e69 100%);
}

.mobile-nav-tab--milestones {
  background: linear-gradient(180deg, #5f7fa6 0%, #506f93 52%, #466384 100%);
}

.mobile-nav-tab--rewards {
  background: linear-gradient(180deg, #8a6e4f 0%, #775c43 52%, #684f3a 100%);
}

.mobile-menu-fade-enter-active,
.mobile-menu-fade-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.24s ease;
}

.mobile-menu-fade-enter-from,
.mobile-menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.985);
  filter: blur(1px);
}

.mobile-menu-fade-enter-to,
.mobile-menu-fade-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  filter: blur(0);
}

.hero {
  position: relative;
  width: min(100%, 1180px);
  margin: 128px auto 0;
  padding: 0 20px;
  text-align: center;
}

.hero__left-decor {
  display: none;
}

.hero__left-decor-wrap {
  display: none;
}

.hero__right-decor {
  display: none;
}

.hero__right-decor-wrap {
  display: none;
}

.hero__title {
  display: inline-flex;
  flex-direction: column;
  line-height: 0.87;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: default;
  opacity: 0;
  transform: translateY(20px) scale(0.98);
  animation: hero-intro-title 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.hero__title-top {
  position: relative;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-weight: 900;
  font-size: clamp(3.7rem, 9.8vw, 9.8rem);
  background: linear-gradient(180deg, #f6f0ff 0%, #dfc2ff 38%, #bf8dff 64%, #9d6fec 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 6px 20px rgba(116, 72, 201, 0.2);
}

.hero__title-bottom {
  position: relative;
  margin-top: 4px;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-weight: 900;
  font-size: clamp(2.45rem, 5.5vw, 5.5rem);
  letter-spacing: 0.02em;
  background: linear-gradient(180deg, #ffffff 0%, #f6efff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.hero__title-top::after,
.hero__title-bottom::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  background: linear-gradient(
    112deg,
    rgba(255, 255, 255, 0) 41%,
    rgba(255, 255, 255, 0.78) 50%,
    rgba(255, 255, 255, 0) 59%
  );
  background-size: 240% 100%;
  background-position: 130% 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  pointer-events: none;
  animation: hero-text-shine 2.9s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}

.hero__title-bottom::after {
  animation-delay: 0.18s;
}

.hero__subtitle {
  margin: 24px auto 0;
  max-width: 980px;
  font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: clamp(1rem, 1.48vw, 1.9rem);
  font-weight: 500;
  line-height: 1.3;
  color: #7f73a9;
  cursor: default;
  opacity: 0;
  transform: translateY(16px);
  animation: hero-intro-subtitle 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.24s forwards;
}

.hero__code {
  display: inline-block;
  white-space: nowrap;
  line-height: 1;
  font-weight: 800;
  color: transparent;
  background-image:
    linear-gradient(180deg, #f6f0ff 0%, #dfc2ff 38%, #bf8dff 64%, #9d6fec 100%),
    linear-gradient(112deg, rgba(255, 255, 255, 0) 41%, rgba(255, 255, 255, 0.78) 50%, rgba(255, 255, 255, 0) 59%);
  background-size:
    100% 100%,
    240% 100%;
  background-position:
    0 0,
    130% 0;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 4px 14px rgba(116, 72, 201, 0.2);
  animation: code-text-shine 2.9s cubic-bezier(0.22, 1, 0.36, 1) 2.3s infinite;
  cursor: default;
}

.hero__code-wrap {
  display: inline-flex;
  align-items: baseline;
  margin-left: 0.18em;
}

.hero__code-caret {
  width: 2px;
  height: 0.95em;
  margin-left: 2px;
  background: rgba(230, 205, 255, 0.92);
  box-shadow: 0 0 8px rgba(187, 134, 255, 0.55);
  animation: caret-blink 0.75s steps(1, end) infinite;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
  margin-top: 28px;
  opacity: 0;
  transform: translateY(14px);
  animation: hero-intro-actions 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.42s forwards;
}

.hero-cta {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 260px;
  height: 52px;
  padding: 0 26px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 1.02rem;
  font-weight: 800;
  line-height: 1;
  overflow: hidden;
  transition:
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.2s ease,
    box-shadow 0.2s ease;
}

.hero-cta::before {
  content: '';
  position: absolute;
  inset: 1px 1px auto;
  height: 48%;
  border-radius: 9px 9px 6px 6px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
}

.hero-cta::after {
  content: '';
  position: absolute;
  inset: -35% auto -35% -22%;
  width: 24%;
  height: 170%;
  transform: rotate(22deg);
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.34) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: nav-shimmer 2.8s ease-in-out infinite;
  pointer-events: none;
}

.hero-cta--primary {
  background: linear-gradient(180deg, #b48aff 0%, #a176f2 52%, #8f63df 100%);
  color: #24143f;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.26),
    inset 0 -1px 0 rgba(0, 0, 0, 0.16),
    0 8px 22px rgba(76, 44, 138, 0.28);
}

.hero-cta--secondary {
  background: linear-gradient(180deg, #6a6280 0%, #5a536f 52%, #4d475f 100%);
  color: #f8f4ff;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.28);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2),
    0 8px 20px rgba(12, 8, 20, 0.32);
}

.hero-cta:hover {
  transform: translateY(-1px);
  filter: brightness(1.06);
}

.hero-cta:active {
  transform: translateY(1px) scale(0.985);
}

.hero-cta:focus-visible {
  outline: 2px solid rgba(168, 142, 219, 0.92);
  outline-offset: 2px;
}

.hero__triangles {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 54px;
  margin-top: 62px;
  opacity: 0;
  animation: decor-fade-in 0.9s ease 1.3s forwards;
}

.hero-triangle {
  position: relative;
  width: 74px;
  height: 56px;
  opacity: 0.52;
  filter: drop-shadow(0 10px 18px rgba(8, 6, 16, 0.32));
  animation: triangle-float 1.8s ease-in-out infinite;
}

.hero-triangle::before,
.hero-triangle::after {
  content: '';
  position: absolute;
  inset: 0;
  clip-path: polygon(50% 100%, 8% 8%, 92% 8%);
}

.hero-triangle::before {
  background: linear-gradient(180deg, rgba(118, 95, 171, 0.54) 0%, rgba(63, 51, 92, 0.54) 100%);
}

.hero-triangle::after {
  inset: 3px 4px 4px;
  clip-path: polygon(50% 100%, 12% 11%, 88% 11%);
  background: linear-gradient(180deg, rgba(36, 30, 50, 0.92) 0%, rgba(27, 23, 40, 0.92) 100%);
}

.hero-triangle--active {
  width: 82px;
  height: 62px;
  opacity: 1;
  filter:
    drop-shadow(0 0 14px rgba(140, 110, 207, 0.55))
    drop-shadow(0 14px 24px rgba(40, 26, 71, 0.36));
  animation-duration: 1.65s;
  animation-delay: -0.2s;
}

.hero-triangle--active::before {
  background: linear-gradient(180deg, rgba(184, 148, 255, 0.9) 0%, rgba(117, 88, 185, 0.82) 100%);
}

.hero-triangle--active::after {
  background: linear-gradient(180deg, rgba(60, 47, 88, 0.9) 0%, rgba(40, 33, 60, 0.9) 100%);
}

.hero-triangle:first-child {
  animation-delay: -0.45s;
}

.hero-triangle:last-child {
  animation-delay: -0.9s;
}

.promo-shell {
  display: block;
  position: relative;
  width: min(100%, 560px);
  height: 760px;
  margin: 280px auto 0;
  margin-bottom: 120px;
  border: 2px solid rgba(167, 128, 240, 0.6);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(33, 28, 47, 0.44) 0%, rgba(24, 20, 36, 0.44) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 16px 34px rgba(8, 6, 15, 0.26);
  overflow: hidden;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.38s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}

.promo-shell__stack {
  display: none;
}

.promo-shell__bg {
  display: none;
}

.promo-shell__mobile-cta {
  display: none;
}

.promo-shell__corner-gift {
  display: none;
}

.promo-shell__flip-bg {
  display: none;
}

.promo-shell__flip-content {
  display: none;
}

  .footer-divider {
  width: 100%;
  height: 1px;
  margin: 0 auto 120px;
  background: rgba(122, 100, 164, 0.52);
}

.footer-decor {
  display: none;
}

.site-footer {
  display: none;
}

.milestones-board {
  display: none;
}

@media (min-width: 1280px) {
  .mobile-menu {
    display: none;
  }
}

@media (min-width: 1280px) {
  .mobile-menu-btn {
    display: none;
  }
}

@media (min-width: 1280px) {
  .nav-tab {
    display: inline-flex;
  }
}

@media (max-width: 1279px) {
  :global(html),
  :global(body) {
    overflow-x: hidden;
  }

  .site-footer {
    display: block;
    width: 100%;
    padding-bottom: 88px;
  }

  .site-footer__inner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 22px;
    width: 100%;
  }

  .site-footer__brand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .site-footer__head {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .site-footer__logo {
    width: 66px;
    height: auto;
    object-fit: contain;
  }

  .site-footer__title,
  .site-footer__col-title {
    margin: 0;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 1.72rem;
    font-weight: 900;
    letter-spacing: 0.02em;
    line-height: 1;
    text-transform: uppercase;
    background: linear-gradient(90deg, #ffffff 0%, #f0e6ff 52%, #b98bff 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
  }

  .site-footer__copy,
  .site-footer__nav-link {
    margin: 0;
    font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.86rem;
    font-weight: 600;
    line-height: 1.25;
    color: rgba(166, 142, 204, 0.92);
    text-transform: uppercase;
    text-decoration: none;
  }

  .site-footer__copy {
    transition:
      color 0.2s ease,
      filter 0.2s ease;
  }

  .site-footer__copy:hover {
    color: #ccb0ff;
    filter: brightness(1.05);
  }

  .site-footer__nav,
  .site-footer__connect {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .site-footer__socials {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .site-footer__social {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: linear-gradient(180deg, #b48aff 0%, #9f74f2 100%);
    color: #2a1746;
    text-decoration: none;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      0 4px 10px rgba(79, 45, 145, 0.35);
  }

  .site-footer__social-icon {
    width: 14px;
    height: 14px;
    object-fit: contain;
    filter: brightness(0) invert(1);
    pointer-events: none;
    user-select: none;
  }

  .leaderboard-timer {
    margin-top: 28px;
  }

  .leaderboard-timer__title {
    font-size: 0.9rem;
  }

  .leaderboard-timer__unit {
    width: 56px;
    height: 62px;
  }

  .leaderboard-timer__unit strong {
    font-size: 1.62rem;
  }

  .leaderboard-panel {
    width: 100%;
    margin-top: 44px;
  }

  .leaderboard-rules {
    width: 100%;
    margin-top: 18px;
    padding: 14px 14px;
  }

  .leaderboard-rules__title {
    font-size: 0.9rem;
  }

  .leaderboard-rules__text,
  .leaderboard-rules__list {
    font-size: 0.86rem;
    line-height: 1.4;
  }

  .leaderboard-after-space {
    height: 60px;
  }

  .leaderboard-throne {
    width: 100%;
    margin-top: 209px;
    gap: 10px;
  }

  .leaderboard-throne__card {
    min-height: 136px;
    padding: 12px 10px 10px;
  }

  .leaderboard-throne__card--1 {
    min-height: 176px;
  }

  .leaderboard-throne__card--2 {
    min-height: 154px;
  }

  .leaderboard-throne__card--3 {
    min-height: 144px;
  }

  .leaderboard-throne__name {
    margin-top: 12px;
    height: 20px;
  }

  .leaderboard-throne__meta {
    margin-top: 8px;
    min-height: 30px;
    padding: 0 8px;
  }

  .leaderboard-throne__meta-label {
    font-size: 0.56rem;
  }

  .leaderboard-throne__meta-value {
    font-size: 0.9rem;
  }

  .leaderboard-panel__head,
  .leaderboard-panel__row {
    grid-template-columns: 0.8fr 1.3fr 1fr 1fr;
    gap: 8px;
    padding: 0 14px;
  }

  .leaderboard-panel__head {
    height: 44px;
    font-size: 0.62rem;
  }

  .leaderboard-panel__row {
    height: 52px;
    font-size: 0.88rem;
  }

  .milestones-board {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    width: 100%;
    margin: 462px auto 76px;
  }

  .milestone-card {
    width: 100%;
    border: 1px solid rgba(154, 146, 255, 0.82);
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(30, 25, 44, 0.9) 0%, rgba(25, 21, 37, 0.9) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 10px 20px rgba(12, 9, 20, 0.24);
    padding: 18px 14px 14px;
    text-align: center;
  }

  .milestone-card--gold {
    border-color: rgba(239, 202, 84, 0.88);
  }

  .milestone-card--vip {
    border-color: rgba(204, 92, 255, 0.9);
  }

  .milestone-card--teal {
    border-color: rgba(25, 243, 205, 0.9);
  }

  .milestone-card__label {
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: rgba(115, 124, 147, 0.9);
  }

  .milestone-card__goal {
    margin-top: 4px;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 2rem;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.01em;
    white-space: nowrap;
    color: #f5f3ff;
  }

  .milestone-card__divider {
    width: 100%;
    height: 1px;
    margin: 12px 0 12px;
    background: rgba(71, 64, 99, 0.35);
  }

  .milestone-card__reward {
    margin-top: 4px;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 2.24rem;
    font-weight: 900;
    line-height: 1;
    color: #9e95ff;
  }

  .milestone-card--gold .milestone-card__reward {
    color: #f4d75f;
  }

  .milestone-card--vip .milestone-card__reward {
    color: #d155ff;
  }

  .milestone-card--teal .milestone-card__reward {
    color: #12e2b7;
  }

  .milestone-card__cta {
    position: relative;
    margin-top: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 42px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 9px;
    background: linear-gradient(180deg, #a39df0 0%, #9590e0 100%);
    color: #1f1635;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.88rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    text-decoration: none;
    overflow: hidden;
  }

  .milestone-card--gold .milestone-card__cta {
    background: linear-gradient(180deg, #f0d15c 0%, #e7c74f 100%);
  }

  .milestone-card--vip .milestone-card__cta {
    background: linear-gradient(180deg, #ca5bf0 0%, #b94ee3 100%);
  }

  .milestone-card--teal .milestone-card__cta {
    background: linear-gradient(180deg, #19e4bc 0%, #12d8ac 100%);
  }

  .milestone-card__cta::after {
    content: '';
    position: absolute;
    inset: -35% auto -35% -22%;
    width: 24%;
    height: 170%;
    transform: rotate(22deg);
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.3) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    animation: nav-shimmer 2.8s ease-in-out infinite;
    pointer-events: none;
  }

  .top-nav {
    min-height: 92px;
  }

  .top-nav__inner {
    height: 92px;
    padding: 0 22px;
  }

  .mobile-menu {
    top: 102px;
  }

  .brand-mark__image {
    height: 96px;
  }

  .hero {
    width: 100%;
    margin-top: 138px;
    padding: 0 34px;
  }

  .hero__title {
    line-height: 0.9;
  }

  .hero__title-top {
    font-size: clamp(3rem, 11vw, 5.2rem);
  }

  .hero__title-bottom {
    margin-top: 4px;
    font-size: clamp(2rem, 8.2vw, 4rem);
  }

  .hero__subtitle {
    margin-top: 24px;
    max-width: 100%;
    font-size: clamp(1rem, 4.8vw, 1.45rem);
    line-height: 1.28;
  }

  .hero__actions {
    margin-top: 28px;
    gap: 12px;
  }

  .hero-cta {
    width: 100%;
    min-width: 100%;
    height: 50px;
    font-size: 1.02rem;
  }

  .hero__triangles {
    width: 100%;
    max-width: 420px;
    justify-content: space-between;
    gap: 0;
    margin: 96px auto 0;
    padding: 0 6px;
  }


  .hero-triangle {
    width: 72px;
    height: 54px;
  }

  .hero-triangle--active {
    width: 82px;
    height: 62px;
  }

  .promo-shell {
    width: min(100%, 560px);
    height: 700px;
    margin-top: 340px;
    margin-bottom: 150px;
  }

  .promo-shell__bg {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0.62;
    pointer-events: none;
    user-select: none;
  }

  .promo-shell__bg--hover {
    display: none;
  }

  .promo-shell__stack {
    display: flex;
    position: relative;
    z-index: 3;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    height: 100%;
    padding-bottom: 64px;
  }

  .promo-shell__stack {
    transition:
      opacity 0.26s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .promo-shell__stack--hidden {
    opacity: 0;
    transform: translateY(18px);
    pointer-events: none;
  }

  .promo-shell__corner-gift {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid rgba(180, 142, 250, 0.62);
    background: linear-gradient(180deg, rgba(73, 58, 103, 0.95) 0%, rgba(54, 43, 77, 0.95) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 7px 14px rgba(20, 11, 32, 0.3);
    appearance: none;
    padding: 0;
    cursor: pointer;
    transition: transform 0.2s ease, filter 0.2s ease;
  }

  .promo-shell__corner-gift img {
    width: 14px;
    height: 14px;
    object-fit: contain;
    filter: brightness(0) invert(1);
    opacity: 0.95;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .promo-shell__corner-gift:active {
    transform: scale(0.92);
  }

  .promo-shell__corner-gift::before,
  .promo-shell__corner-gift::after {
    content: '';
    position: absolute;
    width: 14px;
    height: 2px;
    border-radius: 999px;
    background: rgba(244, 238, 255, 0.96);
    opacity: 0;
    transform: rotate(0deg) scale(0.7);
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .promo-shell__corner-gift--active img {
    opacity: 0;
    transform: scale(0.72) rotate(-16deg);
  }

  .promo-shell__corner-gift--active::before {
    opacity: 1;
    transform: rotate(45deg) scale(1);
  }

  .promo-shell__corner-gift--active::after {
    opacity: 1;
    transform: rotate(-45deg) scale(1);
  }

  .promo-shell__flip-bg {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0;
    transition: opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
    user-select: none;
  }

  .promo-shell__flip-bg--active {
    opacity: 1;
  }

  .promo-shell__flip-content {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 10px;
    padding: 26px 22px 0;
    opacity: 0;
    transform: translateY(8px);
    transition:
      opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .promo-shell__flip-content--active {
    opacity: 1;
    transform: translateY(0);
  }

  .promo-shell__flip-content h3 {
    margin: 0;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 1rem;
    font-weight: 900;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #efe8ff;
    text-shadow: 0 0 8px rgba(188, 145, 255, 0.42);
  }

  .promo-shell__flip-content p {
    margin: 0;
    font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.92rem;
    font-weight: 700;
    line-height: 1.35;
    color: #dcd0ff;
    text-shadow: 0 0 8px rgba(160, 118, 243, 0.3);
  }

  .promo-shell__brand {
    display: block;
    height: auto;
    object-fit: contain;
    user-select: none;
    pointer-events: none;
  }

  .promo-shell__brand--roobet {
    width: 230px;
  }

  .promo-shell__brand--hillbro {
    width: 220px;
    margin-top: -12px;
  }

  .promo-shell__x {
    align-self: center;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 2.05rem;
    font-weight: 900;
    line-height: 1;
    color: rgba(205, 173, 255, 0.9);
    text-shadow: 0 2px 10px rgba(124, 91, 197, 0.35);
    user-select: none;
    pointer-events: none;
  }

  .promo-shell__mobile-cta {
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 20px;
    z-index: 3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: linear-gradient(180deg, #b48aff 0%, #a176f2 52%, #8f63df 100%);
    color: #24143f;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.95rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    line-height: 1;
    text-transform: uppercase;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.28);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.26),
      inset 0 -1px 0 rgba(0, 0, 0, 0.16),
      0 8px 20px rgba(76, 44, 138, 0.28);
    overflow: hidden;
    pointer-events: none;
    transition:
      transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
      filter 0.2s ease,
      box-shadow 0.2s ease;
  }

  .promo-shell__mobile-cta::after {
    content: '';
    position: absolute;
    inset: -35% auto -35% -22%;
    width: 24%;
    height: 170%;
    transform: rotate(22deg);
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.34) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    animation: nav-shimmer 2.8s ease-in-out infinite;
    pointer-events: none;
  }

  .promo-shell:hover .promo-shell__mobile-cta {
    filter: brightness(1.05);
  }

  .promo-shell:active .promo-shell__mobile-cta {
    transform: translateY(1px) scale(0.985);
    filter: brightness(0.98);
  }

  /* Touch devices: keep CTA stable and avoid sticky hover/active artifacts */
  .promo-shell__mobile-cta::after {
    animation: none;
  }

  .promo-shell:hover .promo-shell__mobile-cta,
  .promo-shell:active .promo-shell__mobile-cta {
    transform: none;
    filter: none;
  }

  .footer-divider {
    width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-bottom: 96px;
  }
}

@media (max-width: 600px) {
  .hero {
    padding: 0 22px;
  }

  .mobile-menu {
    left: 10px;
    right: 10px;
    top: 98px;
  }

  .hero__subtitle {
    margin-top: 18px;
  }

  .hero-cta {
    height: 48px;
    font-size: 0.92rem;
  }

  .hero__triangles {
    margin-top: 82px;
  }


  .hero-triangle {
    width: 62px;
    height: 46px;
  }

  .hero-triangle--active {
    width: 70px;
    height: 52px;
  }

  .promo-shell {
    width: 100%;
    height: 520px;
    margin-top: 300px;
    margin-bottom: 130px;
    border-radius: 12px;
  }

  .promo-shell__stack {
    padding-bottom: 48px;
  }

  .promo-shell__brand--roobet {
    width: 190px;
  }

  .promo-shell__brand--hillbro {
    width: 182px;
    margin-top: -8px;
  }

  .promo-shell__x {
    font-size: 1.72rem;
  }

  .promo-shell__mobile-cta {
    left: 12px;
    right: 12px;
    bottom: 14px;
    height: 44px;
    font-size: 0.86rem;
  }

  .promo-shell__corner-gift {
    width: 28px;
    height: 28px;
    top: 7px;
    right: 7px;
  }

  .promo-shell__corner-gift img {
    width: 13px;
    height: 13px;
  }

  .promo-shell__flip-content {
    padding: 22px 16px 0;
    gap: 8px;
  }

  .promo-shell__flip-content h3 {
    font-size: 0.9rem;
  }

  .promo-shell__flip-content p {
    font-size: 0.82rem;
  }

  .footer-divider {
    width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-bottom: 44px;
  }

  .site-footer {
    padding-bottom: 72px;
  }

  .site-footer__title,
  .site-footer__col-title {
    font-size: 1.48rem;
  }

  .site-footer__logo {
    width: 58px;
  }

  .site-footer__copy,
  .site-footer__nav-link {
    font-size: 0.78rem;
  }

  .milestones-board {
    grid-template-columns: 1fr;
    gap: 12px;
    margin: 442px auto 60px;
  }

  .milestone-card {
    border-radius: 12px;
    padding: 16px 12px 12px;
  }

  .milestone-card__goal {
    font-size: 1.74rem;
  }

  .milestone-card__reward {
    font-size: 2rem;
  }

  .milestone-card__cta {
    height: 40px;
    font-size: 0.8rem;
  }

  .leaderboard-timer {
    margin-top: 24px;
  }

  .leaderboard-timer__grid {
    gap: 8px;
  }

  .leaderboard-timer__unit {
    width: 50px;
    height: 56px;
    padding-top: 9px;
  }

  .leaderboard-timer__unit strong {
    font-size: 1.42rem;
  }

  .leaderboard-timer__unit span {
    font-size: 0.52rem;
  }

  .leaderboard-panel {
    margin-top: 36px;
  }

  .leaderboard-rules {
    margin-top: 14px;
    padding: 12px 10px;
  }

  .leaderboard-rules__title {
    font-size: 0.78rem;
  }

  .leaderboard-rules__text,
  .leaderboard-rules__list {
    font-size: 0.76rem;
    line-height: 1.35;
  }

  .leaderboard-after-space {
    height: 46px;
  }

  .leaderboard-throne {
    margin-top: 187px;
    gap: 8px;
  }

  .leaderboard-throne__card {
    min-height: 122px;
    padding: 10px 8px 8px;
  }

  .leaderboard-throne__card--1 {
    min-height: 156px;
  }

  .leaderboard-throne__card--2 {
    min-height: 138px;
  }

  .leaderboard-throne__card--3 {
    min-height: 130px;
  }

  .leaderboard-throne__badge {
    min-width: 40px;
    height: 24px;
    font-size: 0.74rem;
  }

  .leaderboard-throne__name {
    margin-top: 10px;
    height: 18px;
  }

  .leaderboard-throne__meta {
    margin-top: 7px;
    min-height: 28px;
    gap: 6px;
    padding: 0 6px;
  }

  .leaderboard-throne__meta-label {
    font-size: 0.5rem;
    letter-spacing: 0.06em;
  }

  .leaderboard-throne__meta-value {
    font-size: 0.74rem;
  }

  .leaderboard-panel__head,
  .leaderboard-panel__row {
    grid-template-columns: 0.72fr 1fr 1fr 1fr;
    gap: 6px;
    padding: 0 10px;
  }

  .leaderboard-panel__head {
    height: 40px;
    font-size: 0.54rem;
  }

  .leaderboard-panel__row {
    height: 46px;
    font-size: 0.78rem;
  }
}

@media (min-width: 1280px) {
  .hero {
    margin-top: 148px;
  }

  .leaderboard-throne {
    margin-top: 126px;
  }

  .leaderboard-panel {
    margin-top: 38px;
  }

  .hero--milestones .hero__triangles {
    margin-top: 142px;
  }

  .milestones-board {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 20px;
    width: min(100%, 1280px);
    margin: 270px auto 0;
    margin-bottom: 120px;
  }

  .milestone-card {
    width: calc((100% - 60px) / 4);
    min-width: 0;
    border: 1px solid rgba(154, 146, 255, 0.82);
    border-radius: 18px;
    background: linear-gradient(180deg, rgba(30, 25, 44, 0.9) 0%, rgba(25, 21, 37, 0.9) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 12px 24px rgba(12, 9, 20, 0.26);
    padding: 28px 24px 22px;
    text-align: center;
  }

  .milestone-card--gold {
    border-color: rgba(239, 202, 84, 0.88);
  }

  .milestone-card--vip {
    border-color: rgba(204, 92, 255, 0.9);
  }

  .milestone-card--teal {
    border-color: rgba(25, 243, 205, 0.9);
  }

  .milestone-card__label {
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.88rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(115, 124, 147, 0.9);
  }

  .milestone-card__goal {
    margin-top: 6px;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 3.05rem;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.01em;
    white-space: nowrap;
    color: #f5f3ff;
  }

  .milestone-card--vip .milestone-card__goal,
  .milestone-card--teal .milestone-card__goal {
    font-size: clamp(2rem, 1.9vw, 2.55rem);
  }

  .milestone-card__divider {
    width: 100%;
    height: 1px;
    margin: 24px 0 20px;
    background: rgba(71, 64, 99, 0.35);
  }

  .milestone-card__reward {
    margin-top: 6px;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 3.25rem;
    font-weight: 900;
    line-height: 1;
    color: #9e95ff;
  }

  .milestone-card--gold .milestone-card__reward {
    color: #f4d75f;
  }

  .milestone-card--vip .milestone-card__reward {
    color: #d155ff;
  }

  .milestone-card--teal .milestone-card__reward {
    color: #12e2b7;
  }

  .milestone-card__cta {
    position: relative;
    margin-top: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 56px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 10px;
    background: linear-gradient(180deg, #a39df0 0%, #9590e0 100%);
    color: #1f1635;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 1.42rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    text-decoration: none;
    cursor: pointer;
    overflow: hidden;
    transition:
      transform 0.2s ease,
      filter 0.2s ease;
  }

  .milestone-card__cta::after {
    content: '';
    position: absolute;
    inset: -35% auto -35% -22%;
    width: 24%;
    height: 170%;
    transform: rotate(22deg);
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.3) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    animation: nav-shimmer 2.8s ease-in-out infinite;
    pointer-events: none;
  }

  .milestone-card--gold .milestone-card__cta {
    background: linear-gradient(180deg, #f0d15c 0%, #e7c74f 100%);
  }

  .milestone-card--vip .milestone-card__cta {
    background: linear-gradient(180deg, #ca5bf0 0%, #b94ee3 100%);
  }

  .milestone-card--teal .milestone-card__cta {
    background: linear-gradient(180deg, #19e4bc 0%, #12d8ac 100%);
  }

  .milestone-card__cta:hover {
    transform: translateY(-1px);
    filter: brightness(1.05);
  }

  .milestone-card__cta:active {
    transform: translateY(1px) scale(0.99);
  }

  .site-footer {
    display: block;
    width: 100%;
    padding-bottom: 92px;
  }

  .site-footer__inner {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    align-items: flex-start;
    width: 100%;
  }

  .site-footer__brand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    justify-self: start;
  }

  .site-footer__head {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .site-footer__logo {
    width: 74px;
    height: auto;
    object-fit: contain;
  }

  .site-footer__title {
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 2.14rem;
    font-weight: 900;
    letter-spacing: 0.02em;
    line-height: 1;
    text-transform: uppercase;
    background: linear-gradient(90deg, #ffffff 0%, #f0e6ff 52%, #b98bff 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
  }

  .site-footer__copy {
    margin: 0;
    font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.86rem;
    font-weight: 600;
    line-height: 1.25;
    color: rgba(166, 142, 204, 0.92);
    text-transform: uppercase;
    text-decoration: none;
    transition:
      color 0.2s ease,
      filter 0.2s ease;
  }

  .site-footer__copy:hover {
    color: #ccb0ff;
    filter: brightness(1.05);
  }

  .footer-divider {
    margin-bottom: 52px;
  }

  .site-footer__nav,
  .site-footer__connect {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding-top: 6px;
  }

  .site-footer__nav {
    justify-self: center;
  }

  .site-footer__connect {
    justify-self: end;
    margin-left: 0;
  }

  .site-footer__col-title {
    margin: 0 0 4px;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 2.14rem;
    font-weight: 900;
    letter-spacing: 0.02em;
    line-height: 1;
    text-transform: uppercase;
    background: linear-gradient(90deg, #ffffff 0%, #f0e6ff 52%, #b98bff 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
  }

  .site-footer__nav-link {
    font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.86rem;
    font-weight: 600;
    line-height: 1.25;
    color: rgba(166, 142, 204, 0.92);
    text-transform: uppercase;
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .site-footer__nav-link:hover {
    color: #caa8ff;
  }

  .site-footer__socials {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .site-footer__social {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: linear-gradient(180deg, #b48aff 0%, #9f74f2 100%);
    color: #2a1746;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.88rem;
    font-weight: 800;
    text-decoration: none;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      0 4px 10px rgba(79, 45, 145, 0.35);
    transition:
      transform 0.2s ease,
      filter 0.2s ease;
  }

  .site-footer__social-icon {
    width: 14px;
    height: 14px;
    object-fit: contain;
    filter: brightness(0) invert(1);
    pointer-events: none;
    user-select: none;
  }

  .site-footer__social:hover {
    transform: translateY(-1px);
    filter: brightness(1.06);
  }

  .promo-shell__stack {
    display: flex;
    position: relative;
    z-index: 2;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    height: 100%;
    padding-top: 0;
    padding-bottom: 54px;
    transform: translateY(14px);
    transition:
      opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .promo-shell__stack--hidden {
    opacity: 0;
    transform: translateY(22px);
    pointer-events: none;
  }

  .promo-shell__corner-gift {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 1px solid rgba(180, 142, 250, 0.65);
    background: linear-gradient(180deg, rgba(73, 58, 103, 0.95) 0%, rgba(54, 43, 77, 0.95) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 8px 16px rgba(20, 11, 32, 0.34);
    cursor: pointer;
    transition:
      transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
      filter 0.22s ease,
      box-shadow 0.22s ease,
      border-color 0.22s ease;
    appearance: none;
    padding: 0;
  }

  .promo-shell__corner-gift img {
    width: 16px;
    height: 16px;
    object-fit: contain;
    filter: brightness(0) invert(1);
    opacity: 0.95;
    transition:
      opacity 0.2s ease,
      transform 0.2s ease;
  }

  .promo-shell__corner-gift:hover {
    transform: translateY(-2px) scale(1.03);
    filter: brightness(1.08);
    border-color: rgba(206, 173, 255, 0.9);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 0 0 1px rgba(151, 116, 222, 0.24),
      0 0 20px rgba(138, 98, 212, 0.34),
      0 10px 18px rgba(20, 11, 32, 0.4);
  }

  .promo-shell__corner-gift:active {
    transform: translateY(0) scale(0.94);
    filter: brightness(0.98);
  }

  .promo-shell__corner-gift::before,
  .promo-shell__corner-gift::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 2px;
    border-radius: 999px;
    background: rgba(244, 238, 255, 0.96);
    opacity: 0;
    transform: rotate(0deg) scale(0.7);
    transition:
      opacity 0.22s ease,
      transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .promo-shell__corner-gift--active img {
    opacity: 0;
    transform: scale(0.72) rotate(-16deg);
  }

  .promo-shell__corner-gift--active::before {
    opacity: 1;
    transform: rotate(45deg) scale(1);
  }

  .promo-shell__corner-gift--active::after {
    opacity: 1;
    transform: rotate(-45deg) scale(1);
  }

  .promo-shell__flip-bg {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0;
    filter: saturate(1.06) brightness(1.02);
    transform: scale(1.01);
    transition:
      opacity 0.36s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
    user-select: none;
  }

  .promo-shell__flip-bg--active {
    opacity: 1;
    transform: scale(1);
  }

  .promo-shell__flip-content {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 12px;
    padding: 34px 34px 0;
    opacity: 0;
    transform: translateY(10px);
    transition:
      opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
    text-align: left;
  }

  .promo-shell__flip-content--active {
    opacity: 1;
    transform: translateY(0);
  }

  .promo-shell__flip-content h3 {
    margin: 0 0 2px;
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 1.38rem;
    font-weight: 900;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #efe8ff;
    text-shadow:
      0 0 10px rgba(188, 145, 255, 0.48),
      0 0 22px rgba(132, 93, 214, 0.38);
  }

  .promo-shell__flip-content p {
    margin: 0;
    font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 1.12rem;
    font-weight: 700;
    line-height: 1.4;
    color: #dcd0ff;
    text-shadow:
      0 0 8px rgba(160, 118, 243, 0.42),
      0 0 16px rgba(113, 76, 193, 0.28);
  }

  .promo-shell__brand {
    display: block;
    height: auto;
    object-fit: contain;
    user-select: none;
    pointer-events: none;
  }

  .promo-shell__bg {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0.62;
    pointer-events: none;
    user-select: none;
    transition:
      opacity 0.62s cubic-bezier(0.22, 1, 0.36, 1),
      filter 0.62s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .promo-shell__bg--hover {
    opacity: 0;
  }

  .promo-shell:hover .promo-shell__bg--hover {
    opacity: 0.62;
    filter: saturate(1.05) brightness(1.03);
  }

  .promo-shell:hover .promo-shell__bg:not(.promo-shell__bg--hover) {
    opacity: 0;
    filter: saturate(0.98) brightness(0.98);
  }

  .promo-shell:hover {
    border-color: rgba(189, 151, 255, 0.92);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.16),
      0 0 0 1px rgba(151, 116, 222, 0.26),
      0 0 24px rgba(138, 98, 212, 0.35),
      0 16px 34px rgba(8, 6, 15, 0.3);
  }

  .promo-shell__brand--roobet {
    width: 290px;
  }

  .promo-shell__brand--hillbro {
    width: 270px;
    margin-top: 0;
    transform: translate(10px, -34px);
  }

  .promo-shell__x {
    align-self: center;
    transform: translateX(10px);
    font-family: 'Montserrat', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 2.4rem;
    font-weight: 800;
    line-height: 1;
    color: rgba(205, 173, 255, 0.9);
    text-shadow: 0 2px 10px rgba(124, 91, 197, 0.35);
    user-select: none;
    pointer-events: none;
  }

  .hero__left-decor {
    display: block;
    width: 356px;
    height: auto;
    transform: scaleX(-1) rotate(8deg);
    transform-origin: center;
    mix-blend-mode: screen;
    opacity: 0.92;
    filter:
      saturate(1.12)
      drop-shadow(0 10px 18px rgba(8, 6, 16, 0.34))
      drop-shadow(0 0 12px rgba(89, 67, 158, 0.24));
    animation: karambit-sway 7.1s linear infinite;
    pointer-events: none;
    user-select: none;
  }

  .hero__left-decor-wrap {
    display: block;
    position: absolute;
    top: -72px;
    left: -304px;
    opacity: 0;
    animation:
      decor-fade-in 0.9s ease 1.25s forwards,
      karambit-drift 11.8s linear infinite;
    animation-delay:
      1.25s,
      -2.4s;
    pointer-events: none;
    user-select: none;
  }

  .hero__right-decor {
    display: block;
    width: 356px;
    height: auto;
    transform: rotate(-8deg);
    transform-origin: center;
    mix-blend-mode: screen;
    opacity: 0.92;
    filter:
      saturate(1.12)
      drop-shadow(0 10px 18px rgba(8, 6, 16, 0.34))
      drop-shadow(0 0 12px rgba(89, 67, 158, 0.24));
    animation: karambit-sway 7.6s linear infinite;
    animation-delay: -1.2s;
    pointer-events: none;
    user-select: none;
  }

  .hero--milestones .hero__right-decor--retro {
    animation: retro-sway 7.6s linear infinite;
  }

  .hero__right-decor-wrap {
    display: block;
    position: absolute;
    top: -64px;
    right: -300px;
    opacity: 0;
    animation:
      decor-fade-in 0.9s ease 1.35s forwards,
      karambit-drift 12.3s linear infinite;
    animation-delay:
      1.35s,
      -4.1s;
    pointer-events: none;
    user-select: none;
  }

  .footer-decor {
    display: block;
    position: absolute;
    bottom: 430px;
    pointer-events: none;
    user-select: none;
    animation: karambit-drift 12.2s linear infinite;
  }

  .footer-decor--left {
    left: -304px;
    animation-delay: -3.7s;
  }

  .footer-decor--right {
    right: -300px;
    animation-delay: -6.2s;
  }

  .footer-decor__image {
    display: block;
    width: 170px;
    height: auto;
    mix-blend-mode: screen;
    opacity: 0.9;
    filter:
      saturate(1.08)
      drop-shadow(0 10px 18px rgba(8, 6, 16, 0.34))
      drop-shadow(0 0 12px rgba(95, 72, 148, 0.24));
    animation: karambit-sway 7.8s linear infinite;
  }

  .footer-decor__image--weapon {
    width: 356px;
    animation-delay: -1.9s;
  }

  .footer-decor--right .footer-decor__image {
    animation-name: karambit-sway-flipped;
  }

  .footer-decor--right .footer-decor__image--weapon {
    animation-name: karambit-sway-flipped;
  }
}

.nav-tab::before {
  content: '';
  position: absolute;
  inset: 1px 1px auto;
  height: 48%;
  border-radius: 9px 9px 6px 6px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
}

.nav-tab::after {
  content: '';
  position: absolute;
  inset: -35% auto -35% -22%;
  width: 24%;
  height: 170%;
  transform: rotate(22deg);
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.34) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: nav-shimmer 2.8s ease-in-out infinite;
  pointer-events: none;
}

.nav-tab:hover {
  transform: translateY(-1px);
  filter: brightness(1.08) saturate(1.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2),
    0 7px 16px rgba(20, 11, 32, 0.38);
}

.nav-tab:active {
  transform: translateY(1px) scale(0.985);
  filter: brightness(0.98);
}

.nav-tab:focus-visible {
  outline: 2px solid rgba(168, 142, 219, 0.92);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .nav-tab,
  .nav-tab::after,
  .mobile-nav-tab,
  .mobile-nav-tab::after {
    animation: none;
    transition: none;
  }

  .mobile-menu-fade-enter-active,
  .mobile-menu-fade-leave-active {
    transition: none;
  }

  .hero__title-top,
  .hero__title-bottom,
  .hero__title-top::after,
  .hero__title-bottom::after,
  .hero__title,
  .hero__subtitle,
  .hero__actions,
  .hero__code,
  .hero__code-caret,
  .hero-cta,
  .hero-cta::after,
  .hero__left-decor-wrap,
  .hero__left-decor,
  .hero__right-decor-wrap,
  .hero__right-decor,
  .footer-decor,
  .footer-decor__image {
    animation: none;
  }

  .hero__title,
  .hero__subtitle,
  .hero__actions,
  .leaderboard-timer,
  .hero__triangles,
  .hero__left-decor-wrap,
  .hero__right-decor-wrap {
    opacity: 1;
    transform: none;
  }
}

@keyframes nav-shimmer {
  0% {
    transform: translateX(0) rotate(22deg);
    opacity: 0;
  }

  16% {
    opacity: 1;
  }

  44% {
    transform: translateX(560%) rotate(22deg);
    opacity: 0;
  }

  100% {
    transform: translateX(560%) rotate(22deg);
    opacity: 0;
  }
}

@keyframes hero-text-shine {
  0% {
    background-position: 130% 0;
    opacity: 0;
  }

  18% {
    opacity: 1;
  }

  55% {
    background-position: -130% 0;
    opacity: 0;
  }

  100% {
    background-position: -130% 0;
    opacity: 0;
  }
}

@keyframes hero-intro-title {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.98);
    filter: blur(2px);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@keyframes hero-intro-subtitle {
  from {
    opacity: 0;
    transform: translateY(16px);
    filter: blur(1px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

@keyframes hero-intro-actions {
  from {
    opacity: 0;
    transform: translateY(14px);
    filter: blur(1px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

@keyframes decor-fade-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes code-text-shine {
  0% {
    background-position:
      0 0,
      130% 0;
  }

  55% {
    background-position:
      0 0,
      -130% 0;
  }

  100% {
    background-position:
      0 0,
      -130% 0;
  }
}

@keyframes caret-blink {
  0%,
  45% {
    opacity: 1;
  }

  50%,
  100% {
    opacity: 0;
  }
}

@keyframes triangle-float {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.48;
  }

  50% {
    transform: translateY(11px);
    opacity: 0.95;
  }
}

@keyframes karambit-drift {
  0% {
    transform: translate3d(0, 0, 0);
  }

  13% {
    transform: translate3d(13px, -9px, 0);
  }

  29% {
    transform: translate3d(-8px, 11px, 0);
  }

  47% {
    transform: translate3d(15px, 4px, 0);
  }

  66% {
    transform: translate3d(-10px, -9px, 0);
  }

  82% {
    transform: translate3d(9px, 10px, 0);
  }

  100% {
    transform: translate3d(0, 0, 0);
  }
}

@keyframes karambit-sway {
  0% {
    transform: scaleX(-1) rotate(7.2deg) translate3d(0, 0, 0);
  }

  16% {
    transform: scaleX(-1) rotate(10.2deg) translate3d(4px, -2px, 0);
  }

  37% {
    transform: scaleX(-1) rotate(5.6deg) translate3d(-4px, 3px, 0);
  }

  58% {
    transform: scaleX(-1) rotate(10.4deg) translate3d(3px, -3px, 0);
  }

  79% {
    transform: scaleX(-1) rotate(5.9deg) translate3d(-3px, 2px, 0);
  }

  100% {
    transform: scaleX(-1) rotate(7.2deg) translate3d(0, 0, 0);
  }
}

@keyframes karambit-sway-flipped {
  0% {
    transform: rotate(-7.2deg) translate3d(0, 0, 0);
  }

  16% {
    transform: rotate(-10.2deg) translate3d(-4px, -2px, 0);
  }

  37% {
    transform: rotate(-5.6deg) translate3d(4px, 3px, 0);
  }

  58% {
    transform: rotate(-10.4deg) translate3d(-3px, -3px, 0);
  }

  79% {
    transform: rotate(-5.9deg) translate3d(3px, 2px, 0);
  }

  100% {
    transform: rotate(-7.2deg) translate3d(0, 0, 0);
  }
}

@keyframes retro-sway {
  0% {
    transform: rotate(172deg) translate3d(0, 0, 0);
  }

  16% {
    transform: rotate(169deg) translate3d(-4px, -2px, 0);
  }

  37% {
    transform: rotate(173deg) translate3d(4px, 3px, 0);
  }

  58% {
    transform: rotate(168deg) translate3d(-3px, -3px, 0);
  }

  79% {
    transform: rotate(174deg) translate3d(3px, 2px, 0);
  }

  100% {
    transform: rotate(172deg) translate3d(0, 0, 0);
  }
}
</style>
