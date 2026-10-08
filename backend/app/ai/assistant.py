"""ИИ-ассистент двойника на OpenAI: отвечает на вопросы руководителя и пишет сменный отчёт по живым данным.

Модель получает только инструменты чтения: показатели, решения, состояние оборудования, прогнозы ИИ,
историю параметров, сценарный расчёт. Управлять оборудованием ассистент не может — команды подаёт
оператор на пульте HMI через проверки и подтверждение.

Ключ — OPENAI_API_KEY (переменная окружения или файл backend/.env, он не попадает в git), модель — AI_MODEL.
Без ключа (или при сбое сети) ответ собирается по правилам из тех же данных и помечается как офлайн.
AI_LLM=off принудительно включает офлайн-режим.
"""
import json
import logging
import os
import time

import openai

from .. import config  # noqa: F401 — загружает backend/.env до создания клиента
from ..services import insights, kpi, settings
from . import service

MODEL = os.environ.get("AI_MODEL", "gpt-4.1")
MAX_STEPS = 8
log = logging.getLogger("ai.assistant")

SYSTEM = """Ты — ИИ-аналитик цифрового двойника автомобильного завода Allur в Костанае (ул. Промышленная, 41).
Твои пользователи — начальник производства, мастера смен и технологи.

Завод: последовательная линия Сварка → Окраска (катафорез, печь, камеры грунта и эмали) → Сборка (конвейер на 59 постов) → ОТК.
Работа в 2 смены по 8 ч. Цели: OEE не ниже 85 %, брак не выше 2 %, простой критичного оборудования не больше 60 мин в сутки,
цель выпуска 5 500 автомобилей в месяц. План месяца — другое число: сумма плана по моделям из данных (поле plan);
не путай план и цель. Контроллеры линий подключены по OPC UA (PackML), тревоги — по ISA-18.2.

Как отвечать:
- По-русски, коротко: сначала вывод одной-двумя фразами, затем 2–6 пунктов с цифрами и действиями.
- Цифры бери только из инструментов. Если нужных данных нет — так и скажи, не придумывай.
- Обычно нужно 2–3 инструмента: план, узкое место и мероприятия — get_decisions; вероятности — get_month_forecast;
  оборудование и отказы — get_ai_maintenance и get_equipment; брак — get_quality_risk. Причину простоя связывай
  только с тем участком и оборудованием, где она указана в данных.
- Переводи простои и брак в автомобили: простой в минутах делённый на такт участка (такт есть в данных решений).
  Потеря завода — только на узком месте.
- Прогнозы моделей (время до отказа, вероятности, риск брака) называй оценками и указывай их вероятность или интервал.
- Ты только читаешь данные. Управлять оборудованием не можешь: команды подаёт оператор на пульте HMI с подтверждением.
  Если просят остановить или запустить линию — объясни, кто и где это делает, и что проверить перед этим.
- Формат: обычный текст и маркированные списки через «- ». Выделяй главное **жирным**. Без таблиц и заголовков."""

TOOLS = [
    {"name": "get_kpi", "description": "Показатели производства по данным смен: план/факт, загрузка, OEE, брак и простои по участкам, цели завода.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_decisions", "description": "Центр решений: узкое место потока, прогноз месяца при текущем темпе, такт участков, "
     "мероприятия с эффектом в автомобилях, риски оборудования по журналу простоев, отклонения.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_equipment", "description": "Текущее состояние всех контроллеров линии из SCADA: состояние PackML, причина остановки, "
     "скорость, параметры процесса с уставками и пределами, активные тревоги, заполнение буферов.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_ai_maintenance", "description": "Прогноз отказов ИИ: для каждого параметра — тренд к аварийному порогу, время до отказа (мин) "
     "с интервалом, вероятность отказа в ближайший час, рекомендуемое действие, автомобили под угрозой. Плюс аномалии параметров.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_quality_risk", "description": "Модель причин брака: текущий риск брака по участкам и контроллерам при текущем режиме, "
     "главные факторы и пороги параметров, за которыми брак удваивается.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_month_forecast", "description": "Вероятностный прогноз выпуска месяца (Монте-Карло): квантили P10/P50/P90, вероятность выполнить "
     "план и цель, как часто каждый участок становится узким местом; сценарий без ИИ и с предиктивным обслуживанием.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_downtime_events", "description": "Журнал остановок по данным ПЛК: оборудование, состояние, причина, длительность в минутах.",
     "input_schema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 100}},
                      "additionalProperties": False}},
    {"name": "get_param_history", "description": "История параметра из историка SCADA (до 40 точек). controller — id контроллера "
     "(например conveyor-03), param — id параметра (например MotorCurrent); их можно узнать из get_equipment или get_ai_maintenance.",
     "input_schema": {"type": "object", "properties": {"controller": {"type": "string"}, "param": {"type": "string"},
                                                       "minutes": {"type": "number", "minimum": 1, "maximum": 1440}},
                      "required": ["controller", "param"], "additionalProperties": False}},
    {"name": "run_scenario", "description": "Сценарный расчёт выпуска месяца «что если»: мероприятия (id из get_decisions → levers), "
     "смен в сутки, рабочих дней, дополнительных смен.",
     "input_schema": {"type": "object", "properties": {
         "levers": {"type": "array", "items": {"type": "string"}}, "shifts": {"type": "integer", "minimum": 1, "maximum": 3},
         "days": {"type": "integer", "minimum": 1, "maximum": 31}, "extra_shifts": {"type": "integer", "minimum": 0, "maximum": 20}},
         "additionalProperties": False}},
]

_state = {"mode": "unknown", "error": None, "checked": None, "model": MODEL}


# схема инструментов для Chat Completions: тот же список, обёрнутый в function
OPENAI_TOOLS = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}
                for t in TOOLS]


def _has_credentials() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def state() -> dict:
    if os.environ.get("AI_LLM") == "off":
        return {**_state, "mode": "offline", "error": "AI_LLM=off"}
    if _state["mode"] == "unknown" and not _has_credentials():
        return {**_state, "mode": "offline", "error": "ключ OpenAI не задан (OPENAI_API_KEY)"}
    return dict(_state)


def _trim_forecast(f: dict) -> dict:
    return {**{k: v for k, v in f.items() if k != "bins"}, "scenarios": [{k: v for k, v in s.items() if k != "hist"} for s in f["scenarios"]]}


def _trim_quality(q: dict) -> dict:
    return {"target": q.get("target"), "areas": [{**{k: v for k, v in a.items() if k != "controllers"}, "controllers": [
        {**{k: v for k, v in c.items() if k != "drivers"},
         "drivers": [{k: v for k, v in d.items() if k != "curve"} for d in c["drivers"]]} for c in a["controllers"]]}
        for a in q.get("areas", [])]}


def run_tool(name: str, args: dict) -> object:
    if name == "get_kpi":
        return kpi.summary()
    if name == "get_decisions":
        s = insights.summary()
        return {k: s[k] for k in ("base", "best", "levers", "risks", "alerts", "flow", "lostPerMonth", "nominalCapacity", "assumptions")} | \
            {"marginKzt": settings.calc().get("marginKzt")}
    if name == "get_equipment":
        return service.equipment()
    if name == "get_ai_maintenance":
        m = service.maintenance()
        return {k: m[k] for k in ("status", "predictions", "anomalies", "bottleneck")}
    if name == "get_quality_risk":
        return _trim_quality(service.quality())
    if name == "get_month_forecast":
        return _trim_forecast(service.month())
    if name == "get_downtime_events":
        from ..scada import runtime as scada_rt
        if scada_rt.rt.scada is None:
            return {"error": "SCADA не запущена"}
        return scada_rt.rt.scada.db.events(int(args.get("limit", 30)))
    if name == "get_param_history":
        return service.history(args["controller"], args["param"], float(args.get("minutes", 60)))
    if name == "run_scenario":
        return insights.simulate(args.get("levers") or [], args.get("shifts"), args.get("days"), int(args.get("extra_shifts", 0)))
    raise KeyError(f"Неизвестный инструмент {name}")


def chat(history: list[dict]) -> dict:
    """Ответ на последний вопрос диалога. history — [{role: user|assistant, content: str}], последним — вопрос."""
    if os.environ.get("AI_LLM") == "off":
        return offline(history, "AI_LLM=off")
    if not _has_credentials():
        return offline(history, "ключ OpenAI не задан (OPENAI_API_KEY)")
    client = openai.OpenAI(timeout=90, max_retries=1)
    messages: list[dict] = [{"role": "system", "content": SYSTEM}, *({"role": m["role"], "content": m["content"]} for m in history)]
    used: list[str] = []
    t0 = time.time()
    try:
        for _ in range(MAX_STEPS):
            resp = client.chat.completions.create(model=MODEL, messages=messages, tools=OPENAI_TOOLS, temperature=0.2)
            choice = resp.choices[0]
            msg = choice.message
            if not msg.tool_calls:
                break
            messages.append({"role": "assistant", "content": msg.content or "",
                             "tool_calls": [tc.model_dump(exclude_none=True) for tc in msg.tool_calls]})
            for tc in msg.tool_calls:
                used.append(tc.function.name)
                try:
                    args = json.loads(tc.function.arguments or "{}")
                    out = json.dumps(run_tool(tc.function.name, args), ensure_ascii=False, default=str)[:60000]
                except Exception as e:  # ошибка инструмента — модели, а не пользователю
                    out = f"Ошибка: {e}"
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": out})
        if choice.finish_reason == "content_filter":
            _state.update(mode="llm", error=None, checked=time.time())
            return {"reply": "Модель отклонила этот запрос. Переформулируйте вопрос о производстве.", "tools": used,
                    "mode": "llm", "model": resp.model, "seconds": round(time.time() - t0, 1)}
        text = (msg.content or "").strip()
        if choice.finish_reason == "length":
            text += "\n\n(Ответ обрезан по длине.)"
        _state.update(mode="llm", error=None, checked=time.time())
        return {"reply": text or "Нет ответа.", "tools": used, "mode": "llm", "model": resp.model, "seconds": round(time.time() - t0, 1)}
    except openai.AuthenticationError:
        reason = "ключ OpenAI не принят"
    except openai.PermissionDeniedError:
        reason = "у ключа OpenAI нет доступа к модели"
    except openai.RateLimitError:
        reason = "превышен лимит запросов или исчерпан баланс OpenAI"
    except openai.APIStatusError as e:
        reason = f"ошибка API OpenAI ({e.status_code})"
    except openai.APIConnectionError:
        reason = "нет связи с API OpenAI"
    except Exception as e:  # двойник работает и без LLM
        log.warning("Ассистент: %s", e)
        reason = str(e)
    _state.update(mode="offline", error=reason, checked=time.time())
    return offline(history, reason)


REPORT_PROMPT = """Составь сменный отчёт для начальника производства по текущим данным двойника.
Структура (каждый блок — 2–4 пункта):
1. **Итог** — выпуск, OEE и брак к целям, узкое место.
2. **Оборудование сейчас** — аварии и активные тревоги, что стоит.
3. **Прогноз ИИ на следующую смену** — какие узлы идут к отказу и когда, аномалии, риск брака по режиму.
4. **Что сделать** — 3–5 конкретных действий в порядке приоритета, с эффектом в автомобилях.
Используй инструменты, цифры — только из них."""


def report() -> dict:
    return chat([{"role": "user", "content": REPORT_PROMPT}])


def _g(x: float) -> str:
    """Число для текста: десятичная запятая, без лишних нулей."""
    return f"{x:g}".replace(".", ",")


def offline(history: list[dict], reason: str) -> dict:
    """Ответ без LLM: ключевые выводы двойника по правилам. Не понимает вопрос — даёт сводку."""
    question = (history[-1]["content"] if history else "").lower()
    lines: list[str] = []
    s = insights.summary()
    base = s["base"]
    lines.append(f"**Узкое место — {base['bottleneck'].lower()}**: {_g(base['perShift'])} годных за смену; "
                 f"прогноз месяца {base['month']} авто при плане {base['plan']} и цели {base['target']}.")
    m = service.maintenance()
    risky = [p for p in m["predictions"] if p["severity"] != "ok"][:4]
    if risky:
        lines.append("**Прогноз отказов:**")
        for p in risky:
            when = f"через ~{round(p['etaMin'])} мин" if p["etaMin"] is not None else f"вероятность {round(p['probability'] * 100)}% за час"
            cars = f", под угрозой ~{_g(p['carsAtRisk'])} авто" if p.get("carsAtRisk") else ""
            lines.append(f"- {p['equipment']}: {p['paramName'].lower()} {_g(p['value'])} → {_g(p['limit'])} {p['unit']}, {p['failure'].lower()} {when}{cars}. {p['action']}")
    elif m["status"] == "ready":
        lines.append("- Узлов с трендом к аварийному порогу нет.")
    for a in m["anomalies"][:3]:
        lines.append(f"- Аномалия: {a['equipment']}, {a['paramName'].lower()} {'+' if a['shiftSigma'] > 0 else ''}{_g(a['shiftSigma'])}σ от режима — осмотреть узел до тревоги ПЛК.")
    if any(w in question for w in ("брак", "качеств", "дефект")) or not risky:
        q = service.quality()
        worst = max(q.get("areas", []), key=lambda a: a["risk"], default=None)
        if worst:
            top = worst["controllers"][0]
            f = next((f for f in top["factors"] if f["delta"] > 0), None)
            lines.append(f"**Брак:** при текущем режиме риск на участке «{worst['area']}» ≈ {_g(round(worst['risk'] * 100, 1))}% (норма {_g(q['target'])}%)"
                         + (f"; главный фактор — {f['name'].lower()} {_g(f['value'])} {f['unit']}." if f else "."))
    if any(w in question for w in ("план", "месяц", "прогноз", "выполн")):
        fc = service.month()
        b, ai = fc["scenarios"]
        lines.append(f"**Месяц (Монте-Карло, {fc['runs']} прогонов):** P50 {b['p50']} авто (P10–P90 {b['p10']}–{b['p90']}), "
                     f"вероятность плана {round(b['pPlan'] * 100)}%; с предиктивным обслуживанием P50 {ai['p50']}.")
    top_lever = next((lv for lv in s["levers"] if lv["effect"] > 0), None)
    if top_lever:
        lines.append(f"**Сильнейшее мероприятие:** {top_lever['title'].lower()} — +{top_lever['effect']} авто/мес.")
    return {"reply": "\n".join(lines), "tools": [], "mode": "offline", "reason": reason, "model": None, "seconds": 0}
