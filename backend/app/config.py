"""Пути и настройки приложения из переменных окружения.

Статические данные (геометрия площадки, источники НДВ, реестр контроллеров) лежат в app/data и входят
в репозиторий. Изменяемые базы (twin.db, scada.db) создаются в backend/data, который в .gitignore.
"""
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
PROJECT_DIR = BACKEND_DIR.parent

DATA_DIR = APP_DIR / "data"
VAR_DIR = BACKEND_DIR / "data"

# тестовые данные организаторов (docs/case): при первом запуске разбираются в хранилище
CASE_FILE = PROJECT_DIR / "docs" / "case" / "Кейс_Цифровой_двойник_Тестовые_данные.docx"
TWIN_DB = Path(os.environ.get("TWIN_DB", VAR_DIR / "twin.db"))

MAX_UPLOAD = 10 * 1024 * 1024


def _load_env(path: Path) -> None:
    """Секреты для локального запуска (OPENAI_API_KEY) — из backend/.env; переменные окружения важнее файла."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        name, sep, value = line.strip().partition("=")
        if sep and name and not name.startswith("#"):
            os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


_load_env(BACKEND_DIR / ".env")
