"""PackML (ANSI/ISA-TR88.00.02, OPC UA companion spec OPC 30050) — единая модель состояний контроллера.

Каждый ПЛК линии отдаёт одинаковый набор тегов (PackTags): команду, текущее состояние, режим, скорость,
счётчики и код причины останова. Поэтому SCADA рисует одну и ту же панель для робота, печи и конвейера,
а интегратору на заводе достаточно сопоставить теги своего ПЛК с этим интерфейсом.
Коды состояний и команд — стандартные значения PackTags.
"""
from enum import IntEnum


class State(IntEnum):
    UNDEFINED = 0
    CLEARING = 1
    STOPPED = 2
    STARTING = 3
    IDLE = 4
    SUSPENDED = 5
    EXECUTE = 6
    STOPPING = 7
    ABORTING = 8
    ABORTED = 9
    HOLDING = 10
    HELD = 11
    UNHOLDING = 12
    SUSPENDING = 13
    UNSUSPENDING = 14
    RESETTING = 15
    COMPLETING = 16
    COMPLETE = 17


class Command(IntEnum):
    NONE = 0
    RESET = 1
    START = 2
    STOP = 3
    HOLD = 4
    UNHOLD = 5
    SUSPEND = 6
    UNSUSPEND = 7
    ABORT = 8
    CLEAR = 9


class Mode(IntEnum):
    PRODUCTION = 1
    MAINTENANCE = 2
    MANUAL = 3


STATE_RU = {
    State.UNDEFINED: "Нет данных", State.CLEARING: "Очистка", State.STOPPED: "Остановлен", State.STARTING: "Запуск",
    State.IDLE: "Готов", State.SUSPENDED: "Приостановлен", State.EXECUTE: "Работа", State.STOPPING: "Остановка",
    State.ABORTING: "Аварийный останов", State.ABORTED: "Авария", State.HOLDING: "Удержание", State.HELD: "Удержан",
    State.UNHOLDING: "Снятие удержания", State.SUSPENDING: "Приостановка", State.UNSUSPENDING: "Возобновление",
    State.RESETTING: "Сброс", State.COMPLETING: "Завершение", State.COMPLETE: "Завершён",
}
COMMAND_RU = {
    Command.RESET: "Сброс", Command.START: "Пуск", Command.STOP: "Стоп", Command.HOLD: "Удержать",
    Command.UNHOLD: "Снять удержание", Command.SUSPEND: "Приостановить", Command.UNSUSPEND: "Возобновить",
    Command.ABORT: "Аварийная остановка", Command.CLEAR: "Очистить аварию",
}
MODE_RU = {Mode.PRODUCTION: "Производство", Mode.MAINTENANCE: "Обслуживание", Mode.MANUAL: "Ручной"}

ACTING = {State.CLEARING, State.STARTING, State.STOPPING, State.ABORTING, State.HOLDING, State.UNHOLDING,
          State.SUSPENDING, State.UNSUSPENDING, State.RESETTING, State.COMPLETING}
STOPPABLE = set(State) - {State.UNDEFINED, State.STOPPED, State.STOPPING, State.ABORTING, State.ABORTED, State.CLEARING}
ABORTABLE = set(State) - {State.UNDEFINED, State.ABORTING, State.ABORTED}

# команда → (допустимые исходные состояния, переходное состояние, итоговое состояние)
TRANSITIONS = {
    Command.RESET: ({State.STOPPED, State.COMPLETE}, State.RESETTING, State.IDLE),
    Command.START: ({State.IDLE}, State.STARTING, State.EXECUTE),
    Command.HOLD: ({State.EXECUTE, State.SUSPENDED}, State.HOLDING, State.HELD),
    Command.UNHOLD: ({State.HELD}, State.UNHOLDING, State.EXECUTE),
    Command.SUSPEND: ({State.EXECUTE}, State.SUSPENDING, State.SUSPENDED),
    Command.UNSUSPEND: ({State.SUSPENDED}, State.UNSUSPENDING, State.EXECUTE),
    Command.STOP: (STOPPABLE, State.STOPPING, State.STOPPED),
    Command.ABORT: (ABORTABLE, State.ABORTING, State.ABORTED),
    Command.CLEAR: ({State.ABORTED}, State.CLEARING, State.STOPPED),
}

# команды, которые оператор подаёт со SCADA; SUSPEND/UNSUSPEND машина выполняет сама (блокировка/голодание)
OPERATOR_COMMANDS = [Command.RESET, Command.START, Command.HOLD, Command.UNHOLD, Command.STOP, Command.ABORT, Command.CLEAR]
# команды в безопасную сторону: выполняются сразу, без второго шага и при ключе «Местный»
SAFE_COMMANDS = {Command.STOP, Command.HOLD, Command.ABORT, Command.SUSPEND}
# команды, после которых оборудование начинает двигаться: только при замкнутой цепи безопасности
ENERGIZING = {Command.START, Command.RESET, Command.CLEAR, Command.UNHOLD, Command.UNSUSPEND}
# режим можно менять только в устойчивом состоянии без движения
MODE_CHANGE_STATES = {State.STOPPED, State.IDLE, State.ABORTED}
RUNNING = {State.EXECUTE}


def allowed(state: int, command: int) -> bool:
    rule = TRANSITIONS.get(Command(command)) if command in Command._value2member_map_ else None
    return bool(rule) and state in rule[0]


def hint(state: int, command: int) -> str:
    """Почему команда недоступна в этом состоянии — текстом для оператора."""
    name = STATE_RU.get(State(state), str(state)) if state in State._value2member_map_ else str(state)
    if command == Command.START and state in (State.STOPPED, State.COMPLETE):
        return f"В состоянии «{name}» сначала нужен «Сброс»"
    if command == Command.START and state == State.ABORTED:
        return "После аварии: «Очистить аварию», затем «Сброс»"
    if command == Command.RESET and state == State.ABORTED:
        return "После аварии сначала «Очистить аварию»"
    return f"Недоступно в состоянии «{name}»"
