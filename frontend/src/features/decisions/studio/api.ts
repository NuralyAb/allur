/** Вызовы сценарной студии: калибровка модели, прогноз месяца, чувствительность, подбор плана под цель. */
import { get, postJson } from '../../../shared/api/client'
import type { Forecast, ForecastModel, ForecastRequest, PlanResult, Sensitivity } from './types'

export const loadForecastModel = () => get<ForecastModel>('/api/forecast/model')
export const runForecast = (body: ForecastRequest, signal?: AbortSignal) => postJson<Forecast>('/api/forecast', body, signal)
export const loadSensitivity = () => get<Sensitivity>('/api/forecast/sensitivity')
export const findPlan = (body: { target?: number; confidence: number; margin: number }, signal?: AbortSignal) =>
  postJson<PlanResult>('/api/forecast/plan', body, signal)
