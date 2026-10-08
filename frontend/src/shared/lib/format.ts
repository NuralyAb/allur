/** Дата API (ГГГГ-ММ-ДД) → ДД.ММ.ГГГГ. */
export const fmtDate = (d: string) => d.split('-').reverse().join('.')
