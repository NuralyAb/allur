import { expect, test } from '@playwright/test'

test('пульт HMI: авария ПЛК, блокировка пуска, очистка с подтверждением, квитирование и аудит', async ({ page, request }) => {
  await page.goto('/hmi.html?c=conveyor-03')
  const faceplate = page.locator('.faceplate')
  const state = faceplate.locator('.fp-state .state-chip')
  await expect(faceplate.locator('h2')).toHaveText('Конвейер-03')
  await expect(state).toHaveText('Работа')

  // без входа управлять нельзя: кнопки помечены недоступными, нажатие открывает вход
  await expect(faceplate.locator('.cmd', { hasText: 'Стоп' })).toHaveAttribute('aria-disabled', 'true')
  await faceplate.locator('.cmd', { hasText: 'Стоп' }).click({ force: true })
  const login = page.getByRole('dialog', { name: 'Вход в пульт управления' })
  await expect(login).toBeVisible()
  await login.getByLabel('Логин').fill('operator')
  await login.getByLabel('Пароль').fill('operator')
  await login.getByRole('button', { name: 'Войти' }).click()
  await expect(page.locator('.hmi-user')).toContainText('Оператор')

  // на линии оборвалась цепь
  const fault = await request.post('/api/scada/sim/conveyor-03', { data: { action: 'fault', code: 301 } })
  expect(fault.ok()).toBeTruthy()
  await expect(state).toHaveText('Авария')
  await expect(page.locator('.alarm-banner')).toContainText('Обрыв цепи')

  // пуск заблокирован, пульт объясняет почему и подсказывает следующий шаг
  await faceplate.locator('.cmd', { hasText: 'Пуск' }).click({ force: true })
  await expect(page.locator('.toast').last()).toContainText('Очистить аварию')
  await expect(faceplate.locator('.fp-hint')).toContainText('Очистить аварию')

  // очистка — второй шаг с подтверждением
  await faceplate.locator('.cmd', { hasText: 'Очистить аварию' }).click()
  const confirm = page.getByRole('dialog', { name: 'Очистить аварию' })
  await expect(confirm).toContainText('Конвейер-03')
  await confirm.getByLabel(/Причина/).fill('цепь заменена')
  await confirm.getByRole('button', { name: /Подтвердить/ }).click()
  await expect(state).toHaveText('Остановлен')
  await expect(faceplate.locator('.fp-last')).toContainText('Выполнена')

  // оператор не меняет уставки — нужен инженер
  await expect(faceplate.getByText('меняет инженер')).toBeVisible()

  // квитирование тревоги, вернувшейся в норму
  await page.locator('.alarm-banner').getByRole('button', { name: /Квитировать все/ }).click()
  await expect(page.locator('.alarm-banner')).not.toContainText('Обрыв цепи')

  // журнал аудита: команды с причиной, цепочка хешей не нарушена
  await page.getByRole('tab', { name: 'Журнал аудита' }).click()
  await expect(page.locator('.audit-verify')).toContainText('Цепочка хешей цела')
  await expect(page.locator('.journal')).toContainText('цепь заменена')
})
