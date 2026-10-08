import { test, expect, type Page } from '@playwright/test'

async function enterSimulation(page: Page) {
  await page.goto('/?e2e=1')
  await page.getByRole('button', { name: 'Сценарии производства', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Сценарии завода' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Показать отказ', exact: true })).toBeEnabled()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
}

async function assertNoPanelOverlap(page: Page) {
  const boxes = await page.locator('.topbar, .simulation-panel, .simulation-transport').evaluateAll((elements) => elements.map((element) => {
    const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }))
  expect(boxes).toHaveLength(3)
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0)
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
    expect(box.bottom).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  }
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].y)
  expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].y)
}

test('API validates input, isolates sessions and computes comparable forecasts', async ({ request }) => {
  const invalid = await request.post('/api/simulation/sessions', { data: { bufferCapacity: 0 } })
  expect(invalid.status()).toBe(422)
  const a = await (await request.post('/api/simulation/sessions', { data: {} })).json()
  const b = await (await request.post('/api/simulation/sessions', { data: {} })).json()
  const fault = await (await request.post(`/api/simulation/sessions/${a.sessionId}/control`, { data: { action: 'fault' } })).json()
  expect(fault.time).toBe(30); expect(fault.stages[2].state).toBe('FAULT')
  const other = await (await request.get(`/api/simulation/sessions/${b.sessionId}`)).json()
  expect(other.time).toBe(0)
  const missing = await request.get('/api/simulation/sessions/not-found')
  expect(missing.status()).toBe(404)
  const command = await request.post(`/api/simulation/sessions/${a.sessionId}/control`, { data: { action: 'destroy' } })
  expect(command.status()).toBe(422)
  const result = await (await request.post('/api/simulation/compare', { data: {} })).json()
  expect(result.deltaGood).toBe(result.alternative.good - result.baseline.good)
  expect(result.savedMinutes).toBe(35)
  expect(result.effectKzt).toBe(result.deltaGood * 150000 - 30000)
  expect(result.month.alternative).toBeGreaterThan(result.month.baseline)
})

test('failure → queue → blocked paint → recovery; real 3D stays paused and roof preserves state', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await enterSimulation(page)
  await page.getByRole('button', { name: 'Показать отказ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Сборка остановлена' })).toBeVisible()
  await expect(page.getByTestId('simulation-time')).toContainText('00:30')
  await expect(page.locator('canvas')).toHaveAttribute('data-production-fault', 'Конвейер-03')
  await page.getByRole('button', { name: '+15 мин', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('00:45')
  await page.getByRole('button', { name: '+15 мин', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('01:00')
  await expect(page.getByRole('button', { name: 'Показать Камера-02', exact: true })).toContainText('Буфер заполнен')
  await expect(page.getByRole('button', { name: 'Показать Конвейер-03', exact: true })).toContainText('6 / 6')
  await expect(page.getByRole('button', { name: 'Показать буфер PBS', exact: true })).toContainText('6 / 6 кузовов')
  await expect(page.locator('canvas')).toHaveAttribute('data-production-time', '60')
  await expect(page.locator('canvas')).toHaveAttribute('data-production-bodies', '13')
  const positions = await page.locator('canvas').getAttribute('data-production-positions')
  await page.waitForTimeout(1200)
  expect(await page.locator('canvas').getAttribute('data-production-positions')).toBe(positions)
  await page.getByRole('button', { name: 'Показать кровлю', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('01:00')
  await page.getByRole('button', { name: 'Заглянуть внутрь', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Показать Конвейер-03', exact: true })).toContainText('6 / 6')
  for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: '+15 мин', exact: true }).click(); await expect(page.getByRole('button', { name: '+15 мин', exact: true })).toBeEnabled() }
  await expect(page.getByTestId('simulation-time')).toContainText('01:30')
  await expect(page.locator('canvas')).toHaveAttribute('data-production-fault', '')
  await expect(page.getByRole('button', { name: 'Показать Конвейер-03', exact: true })).toContainText('В работе')
  await assertNoPanelOverlap(page)
  await page.screenshot({ path: 'test-results/simulation-desktop.png' })
  expect(errors).toEqual([])
})

test('live stream advances, pause freezes, reset restores and history remains intact', async ({ page }) => {
  await enterSimulation(page)
  await page.getByRole('button', { name: 'Запустить смену', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).not.toContainText('00:00')
  await page.getByRole('button', { name: 'Пауза смены', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Запустить смену', exact: true })).toBeEnabled()
  const time = await page.getByTestId('simulation-time').textContent()
  await page.waitForTimeout(1500)
  expect(await page.getByTestId('simulation-time').textContent()).toBe(time)
  await page.getByRole('button', { name: 'Сбросить смену', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('00:00')
  await page.getByRole('button', { name: 'Вернуться к обзору', exact: true }).click()
  await page.getByRole('navigation', { name: 'Основные разделы' }).getByRole('button', { name: /Аналитика/ }).click()
  await expect(page.getByRole('heading', { name: 'Производственная аналитика', exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.locator('#main-content')).toContainText('4 800')
  await page.getByRole('button', { name: 'Вернуться к заводу', exact: true }).click()
  await page.getByRole('button', { name: 'Сценарии производства', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('00:00')
})

test('what-if handles faster/equal/slower repair, economics and stale parameters', async ({ page }) => {
  await enterSimulation(page)
  await page.getByRole('tab', { name: 'Что если?', exact: true }).click()
  await page.getByRole('button', { name: 'Сравнить сценарии', exact: true }).click()
  await expect(page.getByTestId('delta-good')).toHaveText('+9 авто')
  await expect(page.getByTestId('baseline-good')).toHaveText('113')
  await expect(page.getByTestId('alternative-good')).toHaveText('122')
  await expect(page.getByTestId('effect-kzt')).toContainText('1 320 000')
  await page.getByLabel('Новый ремонт, мин', { exact: true }).fill('55')
  await expect(page.getByText('Параметры изменены. Пересчитайте результат.')).toBeVisible()
  await expect(page.getByTestId('delta-good')).toHaveCount(0)
  await page.getByRole('button', { name: 'Сравнить сценарии', exact: true }).click()
  await expect(page.getByTestId('delta-good')).toHaveText('0 авто')
  await expect(page.getByTestId('effect-kzt')).toContainText('-30 000')
  await page.getByLabel('Новый ремонт, мин', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Сравнить сценарии', exact: true }).click()
  await expect(page.getByTestId('delta-good')).toHaveText(/^-\d+ авто$/)
  await page.getByLabel('Рабочие дни месяца', { exact: true }).fill('1.5')
  await expect(page.getByRole('button', { name: 'Сравнить сценарии', exact: true })).toBeDisabled()
  await page.getByLabel('Рабочие дни месяца', { exact: true }).fill('')
  await expect(page.getByRole('button', { name: 'Сравнить сценарии', exact: true })).toBeDisabled()
})

test('WebSocket outage falls back to HTTP and commands remain usable', async ({ page }) => {
  await page.routeWebSocket('**/api/simulation/**/stream', (socket) => socket.close({ code: 1001, reason: 'E2E outage' }))
  await enterSimulation(page)
  await page.getByRole('button', { name: 'Запустить смену', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).not.toContainText('00:00')
  await page.getByRole('button', { name: 'Пауза смены', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Запустить смену', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Показать отказ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Сборка остановлена' })).toBeVisible()
})

for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1440, height: 560 }]) {
  test(`UI stays within viewport with no overlapping panels ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await enterSimulation(page)
    await assertNoPanelOverlap(page)
    await page.getByRole('tab', { name: 'Что если?', exact: true }).click()
    await page.getByRole('button', { name: 'Сравнить сценарии', exact: true }).click()
    await expect(page.getByTestId('delta-good')).toHaveText('+9 авто')
    await assertNoPanelOverlap(page)
    await page.screenshot({ path: `test-results/simulation-${viewport.width}.png` })
    await page.getByRole('button', { name: 'Свернуть сценарии', exact: true }).click()
    await expect(page.locator('.simulation-panel')).toHaveCount(0)
    await page.getByRole('button', { name: 'Открыть панель', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Сценарии завода' })).toBeVisible()
  })
}

test('fractional tour URL is safe and app works with external network blocked', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto('/?step=1.5&e2e=1')
  await expect(page.getByRole('button', { name: 'Сценарии производства', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Сценарии производства', exact: true }).click()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  await expect(page.locator('canvas')).toHaveAttribute('data-production-bodies', '1')
  expect(errors).toEqual([])
})

test('failed creation and comparison offer retry without corrupting the app', async ({ page }) => {
  let failCreation = true, failComparison = true
  await page.route('**/api/simulation/sessions', (route) => {
    if (failCreation) { failCreation = false; return route.fulfill({ status: 503, body: 'unavailable' }) }
    return route.continue()
  })
  await page.route('**/api/simulation/compare', (route) => {
    if (failComparison) { failComparison = false; return route.fulfill({ status: 503, body: 'unavailable' }) }
    return route.continue()
  })
  await page.goto('/?e2e=1')
  await page.getByRole('button', { name: 'Сценарии производства', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось выполнить действие')
  await page.getByRole('button', { name: 'Новая сессия', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Показать отказ', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: 'Что если?', exact: true }).click()
  await page.getByRole('button', { name: 'Сравнить сценарии', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('503')
  await expect(page.getByTestId('delta-good')).toHaveCount(0)
  await page.getByRole('button', { name: 'Сравнить сценарии', exact: true }).click()
  await expect(page.getByTestId('delta-good')).toHaveText('+9 авто')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('model settings create a new consistent session and end-of-shift/reset work', async ({ page }) => {
  await enterSimulation(page)
  await page.getByText('Параметры новой смены', { exact: true }).click()
  await page.getByLabel('Ёмкость буферов, авто', { exact: true }).fill('1')
  await page.getByLabel('Такт сборки, мин', { exact: true }).fill('4')
  await page.getByRole('button', { name: 'Применить и начать заново', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Показать Конвейер-03', exact: true })).toContainText('такт 4 мин')
  await page.getByRole('button', { name: 'Показать отказ', exact: true }).click()
  await page.getByRole('button', { name: '+15 мин', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Показать Конвейер-03', exact: true })).toContainText('1 / 1')
  await page.getByRole('button', { name: 'К концу ремонта', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('01:25')
  await page.getByRole('button', { name: 'Итог смены', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('08:00')
  await expect(page.getByRole('button', { name: 'Смена завершена', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click()
  await expect(page.getByTestId('simulation-time')).toContainText('00:00')
  await expect(page.getByRole('button', { name: 'Показать Конвейер-03', exact: true })).toContainText('такт 4 мин')
  await expect(page.getByRole('button', { name: 'Показать Конвейер-03', exact: true })).toContainText('0 / 1')
})

test('malformed telemetry is rejected and a valid stream recovers without page errors', async ({ page }) => {
  let corrupt = true
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await page.routeWebSocket('**/api/simulation/**/stream', (socket) => {
    const server = socket.connectToServer()
    server.onMessage((message) => {
      const packet = JSON.parse(String(message))
      socket.send(corrupt ? JSON.stringify({ ...packet, stages: [] }) : message)
    })
  })
  await enterSimulation(page)
  await expect(page.getByRole('alert')).toContainText('некорректное состояние')
  corrupt = false
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Показать отказ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Сборка остановлена' })).toBeVisible()
  expect(errors).toEqual([])
})


test('data workspaces unmount WebGL and factory navigation restores one scene', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?e2e=1')
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  const navigation = page.getByRole('navigation', { name: 'Основные разделы' })
  for (const name of [/Аналитика/, /Центр решений/, /Источники данных/]) {
    const button = navigation.getByRole('button', { name })
    await button.click()
    await expect(button).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('#main-content h1')).toBeVisible()
  }
  await navigation.getByRole('button', { name: /Завод в 3D/ }).click()
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  await navigation.getByRole('button', { name: /Аналитика/ }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(errors).toEqual([])
})
