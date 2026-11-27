"""Durable chat state, independent of the knowledge database."""
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

DB = Path("/data/config/intelligence.sqlite3")


class Missing(Exception):
    pass


class Busy(Exception):
    pass


def now():
    return datetime.now(UTC).isoformat()


def key():
    return uuid4().hex


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@contextmanager
def connect(write=False):
    conn = sqlite3.connect(DB, timeout=3)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        if write:
            conn.execute("BEGIN IMMEDIATE")
        with conn:
            yield conn
    finally:
        conn.close()


def initialize():
    with sqlite3.connect(DB) as conn:
        DB.chmod(0o600)
        conn.execute("PRAGMA journal_mode=WAL")
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1):
            raise RuntimeError("unsupported_chat_schema")
        if not version:
            conn.executescript("BEGIN;\n" + Path(__file__).with_name("schema.sql").read_text() + "\nCOMMIT;")
        conn.execute("UPDATE messages SET state='interrupted' WHERE state IN ('running','acting')")


def found(row):
    if row is None:
        raise Missing
    return dict(row)


def list_chats(query, archived, offset=0):
    with connect() as conn:
        return [dict(row) for row in conn.execute("""
            SELECT c.* FROM chats c WHERE archived=? AND (
                instr(lower(title),lower(?)) > 0 OR EXISTS (
                   SELECT 1 FROM messages m WHERE m.chat=c.id AND instr(lower(m.body),lower(?)) > 0
                ) OR ?=''
            ) ORDER BY updated DESC,id LIMIT 101 OFFSET ?
        """, (int(archived), query, query, query, offset))]


def new_chat(profile, mode, document=''):
    value = key()
    with connect(True) as conn:
        conn.execute("INSERT INTO chats VALUES (?,?,?, ?,0,?,?)", (value, "Neuer Chat", profile, mode, now(), document))
        return found(conn.execute("SELECT * FROM chats WHERE id=?", (value,)).fetchone())


def chat(conn, value):
    return found(conn.execute("SELECT * FROM chats WHERE id=?", (value,)).fetchone())


def update_chat(value, changes):
    with connect(True) as conn:
        existing = chat(conn, value)
        fields = {**existing, **changes, "updated": now()}
        conn.execute("""
            UPDATE chats SET title=:title,profile=:profile,mode=:mode,archived=:archived,updated=:updated WHERE id=:id
        """, fields)
        return chat(conn, value)


def delete_chat(value):
    with connect(True) as conn:
        chat(conn, value)
        if conn.execute("SELECT 1 FROM messages WHERE chat=? AND state IN ('running','acting')", (value,)).fetchone():
            raise Busy
        conn.execute("DELETE FROM chats WHERE id=?", (value,))


def show(value, offset=0):
    with connect() as conn:
        session = chat(conn, value)
        rows = conn.execute("""
            SELECT * FROM (SELECT * FROM messages WHERE chat=? ORDER BY seq DESC LIMIT 81 OFFSET ?)
             ORDER BY seq
        """, (value, offset)).fetchall()
        more = len(rows) > 80
        result = []
        for row in rows[-80:]:
            item = dict(row)
            item.update(json.loads(item.pop("result")))
            item["attachments"] = attachments(conn, value, row["id"])
            result.append(item)
        return {"chat": session, "messages": result, "more": more}


def attachments(conn, value, message):
    return [dict(row) for row in conn.execute("""
        SELECT id,name,size,kind,path,digest FROM attachments WHERE chat=? AND message=?
    """, (value, message))]


def pending_attachment(value, name, size, kind, digest, chunks, path=None):
    with connect(True) as conn:
        chat(conn, value)
        expiry = (datetime.now(UTC) - timedelta(days=1)).isoformat()
        conn.execute("DELETE FROM attachments WHERE message IS NULL AND created<?", (expiry,))
        count = conn.execute("SELECT count(*) FROM attachments WHERE chat=?", (value,)).fetchone()[0]
        if count >= 30:
            raise Busy
        value_id = key()
        conn.execute("INSERT INTO attachments VALUES (?,?,NULL,?,?,?,?,?,?,?)",
                     (value_id, value, name, size, kind, digest, path, encode(chunks), now()))
        return {"id": value_id, "name": name, "size": size, "kind": kind, "path": path, "digest": digest}


def detach(value, aid):
    with connect(True) as conn:
        if not conn.execute("DELETE FROM attachments WHERE id=? AND chat=? AND message IS NULL", (aid,value)).rowcount:
            raise Missing


def begin(value, prompt, files, request_id):
    with connect(True) as conn:
        session = chat(conn, value)
        previous = conn.execute("SELECT chat,body,seq FROM messages WHERE id=? AND role='user'", (request_id,)).fetchone()
        if previous:
            if previous["chat"] != value or previous["body"] != prompt or set(files) != {
                item["id"] for item in attachments(conn,value,request_id)
            }:
                raise Busy
            row = conn.execute("SELECT id FROM messages WHERE chat=? AND seq=?", (value, previous["seq"]+1)).fetchone()
            return row["id"], False
        if session["archived"] or conn.execute(
            "SELECT 1 FROM messages WHERE chat=? AND state IN ('running','acting')", (value,)
        ).fetchone():
            raise Busy
        count = conn.execute("SELECT coalesce(max(seq),0) FROM messages WHERE chat=?", (value,)).fetchone()[0]
        if count >= 2000:
            raise Busy
        conn.execute("INSERT INTO messages (id,chat,seq,role,body,created) VALUES (?,?,?,'user',?,?)",
                     (request_id,value,count+1,prompt,now()))
        for aid in files:
            if not conn.execute("UPDATE attachments SET message=? WHERE id=? AND chat=? AND message IS NULL",
                                (request_id,aid,value)).rowcount:
                raise Missing
        assistant = key()
        conn.execute("""
            INSERT INTO messages (id,chat,seq,role,body,state,created) VALUES (?,?,?,'assistant','','running',?)
        """, (assistant,value,count+2,now()))
        title = session["title"] if count or session["title"] != "Neuer Chat" else " ".join(prompt.split())[:70] or "Dateianfrage"
        conn.execute("UPDATE chats SET title=?,updated=? WHERE id=?", (title,now(),value))
        return assistant, True


def generation(value, message, turns):
    with connect() as conn:
        session = chat(conn,value)
        row = found(conn.execute("SELECT seq FROM messages WHERE chat=? AND id=? AND role='assistant'", (value,message)).fetchone())
        rows = conn.execute("""
            SELECT role,body,route,id FROM messages
            WHERE chat=? AND seq<? AND state='done' ORDER BY seq DESC LIMIT ?
        """, (value,row["seq"],turns*2+1)).fetchall()
        files = conn.execute("""
            SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message AND m.chat=a.chat
            WHERE a.chat=? AND m.seq<? ORDER BY m.seq DESC, a.id LIMIT 12
        """, (value,row["seq"])).fetchall()
        return session, [dict(item) for item in reversed(rows)], [dict(item) for item in files]


def finish(value, message, state, body, route, result, prior="running"):
    with connect(True) as conn:
        return bool(conn.execute("""
            UPDATE messages SET state=?,body=?,route=?,result=? WHERE id=? AND chat=? AND state=?
        """, (state,body,route,encode(result),message,value,prior)).rowcount)


def retry(value, message):
    with connect(True) as conn:
        session = chat(conn,value)
        latest = conn.execute("SELECT id,state FROM messages WHERE chat=? ORDER BY seq DESC LIMIT 1", (value,)).fetchone()
        if session["archived"] or latest is None or latest["id"] != message or latest["state"] not in {
            "done","failed","cancelled","interrupted"
        }:
            raise Busy
        if conn.execute("SELECT route FROM messages WHERE id=?", (message,)).fetchone()["route"] in {"ha_action","automation"}:
            raise Busy
        conn.execute("UPDATE messages SET body='',route='',result='{}',state='running' WHERE id=?", (message,))


def action_claim(value, message):
    with connect(True) as conn:
        if chat(conn,value)["archived"]:
            raise Busy
        row = found(conn.execute("SELECT route,state,result FROM messages WHERE id=? AND chat=?", (message,value)).fetchone())
        if row["state"] != "confirmation":
            raise Busy
        conn.execute("UPDATE messages SET state='acting' WHERE id=?", (message,))
        return row["route"], json.loads(row["result"])["action"]


def load_config(name):
    with connect() as conn:
        row = conn.execute("SELECT body FROM configuration WHERE name=?", (name,)).fetchone()
        return json.loads(row[0]) if row else None


def save_config(name, body):
    with connect(True) as conn:
        conn.execute("INSERT INTO configuration VALUES (?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body",
                     (name,encode(body)))


def recent_routes():
    with connect() as conn:
        return [dict(row) for row in conn.execute("""
            SELECT route,state,created FROM messages WHERE role='assistant' AND route!=''
            ORDER BY created DESC LIMIT 20
        """)]
