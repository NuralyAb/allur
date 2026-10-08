import { chromium } from '@playwright/test'
const out = process.argv[2]
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
let hmi = null
const errs = []
ctx.on('page', (pg) => { hmi = pg })
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)
await p.screenshot({ path: `${out}/final-sidebar.png` })
// 1. кнопка пульта в меню
await p.getByRole('link', { name: /Пульт HMI/ }).click()
await p.waitForTimeout(2500)
console.log('1. кнопка в меню →', hmi ? hmi.url() : 'не открылось')
// 2. вход по роли
await hmi.waitForLoadState('networkidle'); await hmi.waitForTimeout(1200)
await hmi.getByRole('button', { name: 'Войти' }).first().click(); await hmi.waitForTimeout(600)
await hmi.screenshot({ path: `${out}/final-login.png` })
await hmi.getByRole('button', { name: /Инженер АСУ ТП/ }).click()
await hmi.waitForTimeout(1800)
console.log('2. вход по роли →', await hmi.locator('.hmi-user b').textContent().catch(() => '—'))
// 3. клик по оборудованию в 3D
await p.getByRole('button', { name: /Кузов и окраска/ }).first().click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /Сварка кузовов/ }).first().click(); await p.waitForTimeout(6000)
let spot = null
for (let y = 430; y <= 780 && !spot; y += 35) for (let x = 400; x <= 1150; x += 35) {
  await p.mouse.move(x, y); await p.waitForTimeout(25)
  if (await p.evaluate(() => document.body.style.cursor) === 'pointer') { spot = [x, y]; break }
}
if (spot) { await p.mouse.click(...spot); await p.waitForTimeout(2500) }
console.log('3. клик по оборудованию →', hmi ? new URL(hmi.url()).searchParams.get('c') : 'нет')
await hmi.waitForTimeout(1500)
await hmi.screenshot({ path: `${out}/final-hmi.png` })
console.log('ошибок:', errs.length ? errs : 'нет')
await b.close()
