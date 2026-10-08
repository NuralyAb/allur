"""Учётные записи и вход администратора.

Пользователи общие со SCADA (один файл, те же роли, admin — высшая), но у админки своя копия Auth с собственными
сессиями: она работает и при SCADA_MODE=off. После правок файл перечитывают обе копии.
"""
import json
from pathlib import Path

from fastapi import Header, HTTPException

from ..scada import auth

USERS_PATH: Path = auth.USERS_FILE
_auth: auth.Auth | None = None


def service() -> auth.Auth:
    global _auth
    if _auth is None:
        _auth = auth.Auth(USERS_PATH)
    return _auth


def configure(path: Path) -> None:
    """Для тестов: другой файл пользователей и чистые сессии."""
    global USERS_PATH, _auth
    USERS_PATH = path
    _auth = auth.Auth(path)


def token_of(authorization: str | None) -> str | None:
    return authorization[7:] if authorization and authorization.startswith("Bearer ") else None


def user_of(authorization: str | None) -> auth.User:
    return service().user(token_of(authorization))


def admin_user(authorization: str | None = Header(None)) -> auth.User:
    """Зависимость FastAPI: действие доступно только администратору."""
    user = user_of(authorization)
    if user is auth.GUEST:
        raise HTTPException(401, "Войдите как администратор")
    if not auth.allows(user.role, "admin"):
        raise HTTPException(403, f"Нужна роль «{auth.ROLE_RU['admin']}»")
    return user


# --- управление пользователями --------------------------------------------------------------------

class AccountError(ValueError):
    pass


def _read() -> dict:
    return json.loads(USERS_PATH.read_text(encoding="utf-8"))


def _write(data: dict) -> None:
    USERS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    service().reload()
    try:  # SCADA держит свою копию пользователей
        from ..scada import runtime
        if runtime.rt.users is not None:
            runtime.rt.users.reload()
    except Exception:  # SCADA не запущена или ещё не загружена
        pass


def public(u: dict) -> dict:
    return {"login": u["login"], "name": u["name"], "role": u["role"], "roleName": auth.ROLE_RU[u["role"]], "blocked": bool(u.get("blocked"))}


def list_users() -> list[dict]:
    return [public(u) for u in _read()["users"]]


def _check_login(login: str) -> str:
    login = (login or "").strip().lower()
    if not login or len(login) > 64 or not login.replace(".", "").replace("_", "").replace("-", "").isalnum():
        raise AccountError("Логин: латиница, цифры, точка, дефис или подчёркивание, до 64 символов")
    return login


def _check_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 6 or len(password) > 128:
        raise AccountError("Пароль: от 6 до 128 символов")
    return password


def _check_role(role: str) -> str:
    if role not in auth.ROLES:
        raise AccountError(f"Роль: {', '.join(auth.ROLES)}")
    return role


def create_user(login: str, name: str, role: str, password: str) -> dict:
    data = _read()
    login = _check_login(login)
    if any(u["login"] == login for u in data["users"]):
        raise AccountError("Такой логин уже есть")
    name = (name or "").strip()
    if not name or len(name) > 80:
        raise AccountError("Имя: до 80 символов")
    user = {"login": login, "name": name, "role": _check_role(role), **auth.hash_password(_check_password(password))}
    data["users"].append(user)
    _write(data)
    return public(user)


def _find(data: dict, login: str) -> dict:
    for u in data["users"]:
        if u["login"] == login:
            return u
    raise AccountError("Пользователь не найден")


def _keep_admin(data: dict, login: str, role: str | None, blocked: bool | None) -> None:
    """Нельзя оставить систему без действующего администратора."""
    def active_admin(u: dict) -> bool:
        if u["login"] != login:
            return u["role"] == "admin" and not u.get("blocked")
        return (role or u["role"]) == "admin" and not (u.get("blocked") if blocked is None else blocked)
    if not any(active_admin(u) for u in data["users"]):
        raise AccountError("Должен остаться хотя бы один активный администратор")


def update_user(login: str, actor: str, role: str | None = None, blocked: bool | None = None, name: str | None = None) -> dict:
    data = _read()
    u = _find(data, login)
    if login == actor and (blocked or (role is not None and role != "admin")):
        raise AccountError("Нельзя заблокировать или понизить самого себя")
    if role is not None:
        role = _check_role(role)
    _keep_admin(data, login, role, blocked)
    if role is not None:
        u["role"] = role
    if blocked is not None:
        if blocked:
            u["blocked"] = True
        else:
            u.pop("blocked", None)
        service().revoke(login)
    if name is not None:
        name = name.strip()
        if not name or len(name) > 80:
            raise AccountError("Имя: до 80 символов")
        u["name"] = name
    _write(data)
    return public(u)


def reset_password(login: str, password: str) -> dict:
    data = _read()
    u = _find(data, login)
    u.update(auth.hash_password(_check_password(password)))
    _write(data)
    service().revoke(login)
    return public(u)


def delete_user(login: str, actor: str) -> None:
    if login == actor:
        raise AccountError("Нельзя удалить самого себя")
    data = _read()
    _find(data, login)
    _keep_admin(data, login, None, True)
    data["users"] = [u for u in data["users"] if u["login"] != login]
    _write(data)
    service().revoke(login)
