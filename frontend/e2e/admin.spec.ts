import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/admin.html')
  await page.getByLabel('Логин').fill('admin')
  await page.getByLabel('Пароль').fill('admin')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible()
}

test('admin login is required and only for administrators', async ({ page, request }) => {
  expect((await request.post('/api/data/reset')).status()).toBe(401)
  expect((await request.post('/api/admin/login', { data: { login: 'operator', password: 'operator' } })).status()).toBe(403)
  await page.goto('/admin.html')
  await page.getByLabel('Логин').fill('admin')
  await page.getByLabel('Пароль').fill('wrong')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toContainText('Неверный логин или пароль')
})

test('overview shows statistics with charts and tables', async ({ page }) => {
  await login(page)
  await expect(page.locator('.tile')).toHaveCount(6)
  await expect(page.locator('.chart-card svg')).toHaveCount(4)
  await expect(page.getByText('Окраска', { exact: true }).first()).toBeVisible()
  await page.locator('.chart-table summary').first().click()
  await expect(page.locator('.chart-table table').first()).toContainText('Сварка')
})

test('settings change targets used by the twin and reset to defaults', async ({ page, request }) => {
  await login(page)
  await page.goto('/admin.html#settings')
  const targets = page.locator('.settings .panel').first()
  await targets.getByLabel('OEE, не менее, %').fill('90')
  await targets.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status')).toContainText('сохранено')
  expect((await (await request.get('/api/kpi')).json()).targets.oee).toBe(90)
  await targets.getByRole('button', { name: 'По умолчанию' }).click()
  await expect(page.getByRole('status')).toContainText('по умолчанию')
  expect((await (await request.get('/api/kpi')).json()).targets.oee).toBe(85)
})

test('plant passport edits apply to the twin API and can be reset', async ({ page, request }) => {
  await login(page)
  await page.goto('/admin.html#plant')
  const row = page.locator('table.editable tr').filter({ hasText: 'welding' })
  await row.locator('input').first().fill('Сварка кузовов (ЦСК)')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status')).toContainText('сохранён')
  const zones = (await (await request.get('/api/plant')).json()).zones
  expect(zones.find((z: { id: string }) => z.id === 'welding').name).toBe('Сварка кузовов (ЦСК)')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Сбросить к источникам' }).click()
  await expect(page.getByRole('status')).toContainText('исходному')
  expect((await (await request.get('/api/plant')).json()).customized).toBe(false)
})

test('users can be created, blocked and deleted; audit records it', async ({ page }) => {
  await login(page)
  await page.goto('/admin.html#users')
  await page.getByLabel('Логин').fill('shift1')
  await page.getByLabel('Имя').fill('Начальник смены')
  await page.getByLabel('Пароль').fill('shift123')
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page.getByRole('status')).toContainText('создан')
  const row = page.locator('table tr').filter({ hasText: 'shift1' })
  await row.getByRole('button', { name: 'Заблокировать' }).click()
  await expect(row).toContainText('заблокирован')
  page.once('dialog', (d) => d.accept())
  await row.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('status')).toContainText('удалён')
  await page.goto('/admin.html#audit')
  await expect(page.locator('table')).toContainText('user.create')
  await expect(page.locator('table')).toContainText('user.delete')
})
