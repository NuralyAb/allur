"""Пользователи и роли SCADA. Смотреть могут все в сети завода, управлять — только после входа.

Роли: наблюдатель — только чтение; оператор — пуск, стоп, сброс, квитирование тревог;
инженер — также уставки, скорость, режимы и отложение тревог; администратор — всё это плюс админка двойника.
Учётные записи — data/scada_users.json (путь — SCADA_USERS), пароли хранятся как PBKDF2-SHA256.
На заводе этот модуль заменяется входом через AD/LDAP или OIDC (Keycloak) с теми же ролями.
"""
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path

USERS_FILE = Path(os.environ.get("SCADA_USERS", Path(__file__).resolve().parents[1] / "data" / "scada_users.json"))
ROLES = ("viewer", "operator", "engineer", "admin")
ROLE_RU = {"viewer": "Наблюдатель", "operator": "Оператор", "engineer": "Инженер АСУ ТП", "admin": "Администратор"}
SESSION_SECONDS = 12 * 3600  # смена плюс запас
MAX_FAILS, LOCK_SECONDS = 5, 300
ITERATIONS = 200_000


class Forbidden(Exception):
    pass


@dataclass(frozen=True)
class User:
    login: str
    name: str
    role: str


GUEST = User("гость", "Без входа", "viewer")


def allows(role: str, need: str) -> bool:
    return ROLES.index(role) >= ROLES.index(need)


def require(user: User, need: str):
    if not allows(user.role, need):
        raise Forbidden(f"Нужна роль «{ROLE_RU[need]}»")


def hash_password(password: str, salt: str | None = None) -> dict:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS).hex()
    return {"salt": salt, "hash": digest}


class Auth:
    def __init__(self, path: Path = USERS_FILE):
        self.path = Path(path)
        self.users: dict[str, dict] = {}
        self.sessions: dict[str, tuple[User, float]] = {}
        self.fails: dict[str, tuple[int, float]] = {}
        self.reload()

    def reload(self):
        """Перечитать файл пользователей; сессии сохраняются."""
        self.users = {u["login"]: u for u in json.loads(self.path.read_text(encoding="utf-8"))["users"]}

    def revoke(self, login: str):
        """Завершить все сессии пользователя — после блокировки или смены пароля."""
        self.sessions = {t: s for t, s in self.sessions.items() if s[0].login != login}

    def login(self, login: str, password: str) -> tuple[str, User]:
        now = time.time()
        fails, since = self.fails.get(login, (0, now))
        if now - since >= LOCK_SECONDS:  # окно подсчёта ошибок истекло — считаем заново
            fails, since = 0, now
        if fails >= MAX_FAILS:
            raise Forbidden(f"Слишком много попыток. Повторите через {int(LOCK_SECONDS - (now - since)) // 60 + 1} мин")
        u = self.users.get(login)
        ok = u is not None and hmac.compare_digest(hash_password(password, u["salt"])["hash"], u["hash"])
        if not ok:
            self.fails[login] = (fails + 1, since)
            raise Forbidden("Неверный логин или пароль")
        if u.get("blocked"):
            raise Forbidden("Учётная запись заблокирована")
        self.fails.pop(login, None)
        user = User(u["login"], u["name"], u["role"])
        token = secrets.token_urlsafe(32)
        self.sessions = {t: s for t, s in self.sessions.items() if s[1] > now}
        self.sessions[token] = (user, now + SESSION_SECONDS)
        return token, user

    def logout(self, token: str):
        self.sessions.pop(token, None)

    def user(self, token: str | None) -> User:
        s = self.sessions.get(token or "")
        return s[0] if s and s[1] > time.time() else GUEST
