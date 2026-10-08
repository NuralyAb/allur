/** HTTP-клиент API двойника: JSON-запросы к тому же origin, ошибки сервера — в сообщении исключения. */

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** Ответ 4xx с `detail.errors` превращается в ошибку со списком причин для пользователя. */
export async function post<T>(path: string, body?: BodyInit): Promise<T> {
  const res = await fetch(path, { method: 'POST', body })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const errors: string[] = json?.detail?.errors ?? [typeof json?.detail === 'string' ? json.detail : `${path}: HTTP ${res.status}`]
    throw Object.assign(new Error(errors.join('\n')), { errors })
  }
  return json as T
}
