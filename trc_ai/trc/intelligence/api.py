"""Chat API with independent roles and actionable confirmations."""
import asyncio
from contextlib import suppress
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from typing import Annotated, Literal
from uuid import UUID

import httpx
import psycopg
from fastapi import Query, Request
from pydantic import BaseModel, ConfigDict, Field

from ..rag.config import UPLOADS
from ..rag.extract import Rejected
from ..rag.providers import Temporary
from ..rag.store import Store, relative
from ..rag.upload import QuotaReached, filename, publish
from . import routing, store

Mode = Literal["auto","general","knowledge","documents","market","home","hermes"]
ProfileId = Literal["general","jarvis","friday"]


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Chat(Command):
    profile: ProfileId = "general"
    mode: Mode = "auto"
    document: str = Field(default="",max_length=1500)


class Edit(Command):
    title: str | None = Field(default=None,min_length=1,max_length=100)
    mode: Mode | None = None
    profile: ProfileId | None = None
    archived: bool | None = None


class Message(Command):
    request_id: UUID
    text: str = Field(max_length=3000)
    attachments: list[UUID] = Field(default_factory=list,max_length=4)


class RouteTest(Command):
    text: str = Field(min_length=3,max_length=1200)
    mode: Mode = "auto"


class Confirm(Command):
    confirmed: Literal[True]


def install(app, authorize, read_model, require_database, ApiError):
    def restricted(call,*args):
        if not app.state.chat_ready:
            raise ApiError(503,"chat_unavailable","Der Chat-Speicher ist nicht verfügbar.")
        try:
            return call(*args)
        except store.Missing:
            raise ApiError(404,"chat_record","Eintrag nicht gefunden.") from None
        except store.Busy:
            raise ApiError(409,"chat_busy","Der Auftrag ist belegt oder das Chatlimit ist erreicht.") from None
        except sqlite3.Error:
            raise ApiError(503,"chat_storage","Der Chat-Speicher ist zurzeit nicht erreichbar.") from None

    async def operator(request):
        return await authorize(request,"admin","chat")

    def config():
        return restricted(routing.policy)

    def present(value):
        availability = {
            "auto": True, "general": routing.enabled("ollama"), "knowledge": True, "documents": True,
            "market": True, "home": routing.enabled("home-assistant") and bool(value.entities),
            "hermes": routing.enabled("hermes") and any("hermes" in p.tools for p in value.profiles.values()),
        }
        return {"profiles":{k:{"name":p.name,"description":p.description} for k,p in value.profiles.items()},
                "modes":availability}

    @app.get("/api/v1/intelligence/session")
    async def session(request: Request):
        role = await operator(request)
        info = present(config()) if app.state.chat_ready else {"profiles":{},"modes":{}}
        return {**info,"role":role,"chat_available":app.state.chat_ready}

    @app.get("/api/v1/admin/intelligence")
    async def admin_settings(request: Request):
        await authorize(request,"admin")
        value = config()
        return {"policy":value.model_dump(),"recent":restricted(store.recent_routes),**present(value)}

    @app.put("/api/v1/admin/intelligence")
    async def admin_update(request: Request):
        await authorize(request,"admin")
        value = await read_model(request,routing.Policy)
        if not routing.check_policy(value):
            raise ApiError(422,"chat_policy","Profile, Werkzeugfreigaben und Entitätslisten prüfen.")
        restricted(store.save_config,"policy",value.model_dump())
        return {"saved":True}

    @app.post("/api/v1/admin/intelligence/test-routing")
    async def test_routing(request: Request):
        await authorize(request,"admin")
        payload=await read_model(request,RouteTest)
        route=routing.choose(payload.text,payload.mode,[{"id":"","role":"user","body":payload.text}],[],config())
        return {"route":route}

    @app.get("/api/v1/intelligence/chats")
    async def chats(request: Request, q: Annotated[str,Query(max_length=150)]="", archived: bool=False,
                    offset: Annotated[int,Query(ge=0,le=10000)]=0):
        await operator(request)
        rows=restricted(store.list_chats,q.strip(),archived,offset)
        return {"chats":rows[:100],"more":len(rows)>100}

    @app.post("/api/v1/intelligence/chats",status_code=201)
    async def new(request: Request):
        await operator(request)
        command=await read_model(request,Chat)
        try:
            target = relative(command.document) if command.document else ""
        except Rejected:
            raise ApiError(422,"chat_document","Der Dokumentpfad ist ungültig.") from None
        return restricted(store.new_chat,command.profile,command.mode,target)

    @app.get("/api/v1/intelligence/chats/{chat_id}")
    async def show(request: Request,chat_id: UUID, offset: Annotated[int,Query(ge=0,le=2000)]=0):
        await operator(request)
        result=restricted(store.show,chat_id.hex,offset)
        result["modes"]=present(config())["modes"]
        for message in result["messages"]:
            if message["state"]=="running":
                message["body"]=app.state.chat_partials.get(message["id"],"")
        return result

    @app.patch("/api/v1/intelligence/chats/{chat_id}")
    async def edit(request: Request,chat_id: UUID):
        await operator(request)
        command=await read_model(request,Edit)
        changes=command.model_dump(exclude_none=True)
        if "title" in changes and not changes["title"].strip():
            raise ApiError(422,"chat_title","Der Titel darf nicht leer sein.")
        return restricted(store.update_chat,chat_id.hex,changes)

    @app.delete("/api/v1/intelligence/chats/{chat_id}")
    async def remove(request: Request,chat_id: UUID):
        await operator(request)
        restricted(store.delete_chat,chat_id.hex)
        return {"deleted":True}

    def save_global(data,name,digest):
        require_database()
        cfg=app.state.knowledge_config
        with tempfile.NamedTemporaryFile(dir=UPLOADS, prefix=".incoming-",delete=False) as f:
            staged=Path(f.name)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        try:
            return publish(Store(cfg,None),staged,digest[:20]+"-"+name,digest,len(data),
                           cfg.rag_upload_quota_mib*1024**2)["path"]
        finally:
            staged.unlink(missing_ok=True)

    async def parse_attachment(data,name):
        cfg=app.state.knowledge_config
        child=await asyncio.create_subprocess_exec(
            sys.executable,"-m","trc.rag.parse_worker",Path(name).suffix.lower(),cfg.rag_ocr_language,
            "docling" if cfg.rag_docling else "native",
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True
        )
        try:
            async with asyncio.timeout(215):
                awaitable,_=await child.communicate(data)
            if child.returncode or not awaitable:
                raise Rejected("parser")
            payload=json.loads(awaitable)
            chunks=payload.get("chunks")
            if not chunks or sum(len(row["text"]) for row in chunks)>240000:
                raise Rejected("attachment_size")
            return [{"text":row["text"],"location":row["location"]} for row in chunks]
        finally:
            if child.returncode is None:
                with suppress(ProcessLookupError):
                    os.killpg(child.pid,9)
                await child.wait()

    @app.put("/api/v1/intelligence/chats/{chat_id}/attachments/{name}",status_code=201)
    async def upload(request: Request,chat_id: UUID,name: str, kind: Literal["private","global"]="private"):
        role=await operator(request)
        if kind=="global" and role!="admin":
            raise ApiError(403,"global_document","Die dauerhafte Ablage benötigt Administrationsrechte.")
        restricted(store.show,chat_id.hex)
        try:
            filename(name)
            if len(name.encode())>190:
                raise Rejected("name")
        except Rejected:
            raise ApiError(422,"attachment_name","Dateiname oder Format ist ungültig.") from None
        if request.headers.get("content-type","").split(";")[0].strip().lower()!="application/octet-stream":
            raise ApiError(415,"attachment_type","application/octet-stream ist erforderlich.")
        if app.state.upload_limit.locked():
            raise ApiError(429,"attachment_busy","Eine Datei wird gerade verarbeitet.")
        async with app.state.upload_limit:
            try:
                async with asyncio.timeout(90):
                    data=bytearray()
                    async for part in request.stream():
                        data.extend(part)
                        if len(data)>app.state.knowledge_config.rag_upload_mib*1024**2:
                            raise ApiError(413,"attachment_size","Die Datei ist zu groß.")
                if not data:
                    raise ApiError(422,"attachment_empty","Die Datei ist leer.")
                digest=hashlib.sha256(data).hexdigest()
                path=await asyncio.to_thread(save_global,data,name,digest) if kind=="global" else None
                chunks=await parse_attachment(data,name) if kind=="private" else []
                return restricted(store.pending_attachment,chat_id.hex,name,len(data),kind,digest,chunks,path)
            except QuotaReached:
                raise ApiError(413,"attachment_quota","Die Dokumentablage hat ihr Speicherlimit erreicht.") from None
            except (Rejected,TimeoutError,ValueError):
                raise ApiError(422,"attachment_parse","Die Datei konnte nicht innerhalb der Verarbeitungsgrenzen gelesen werden.") from None
            except (OSError,psycopg.Error):
                raise ApiError(503,"attachment_storage","Die Dokumentablage ist nicht erreichbar.") from None

    @app.delete("/api/v1/intelligence/chats/{chat_id}/attachments/{attachment}")
    async def detach(request: Request,chat_id: UUID,attachment: UUID):
        await operator(request)
        restricted(store.detach,chat_id.hex,attachment.hex)
        return {"removed":True}

    async def generate(chat_id,message):
        route=""
        try:
            value=config()
            session_data,context,files=restricted(store.generation,chat_id,message,value.turns)
            profile=value.profiles[session_data["profile"]]
            question=context[-1]["body"]
            mode=session_data["mode"]
            if mode=="auto":
                mode=profile.preferred
            route=routing.choose(question,mode,context,files,value)
            async with asyncio.timeout(value.timeout):
                state,body,extra=await routing.answer_route(route,question,context,files,profile,value,
                    app.state.knowledge_config,session_data["document"],lambda partial:app.state.chat_partials.__setitem__(message,partial))
            restricted(store.finish,chat_id,message,state,body,route,extra)
        except asyncio.CancelledError:
            restricted(store.finish,chat_id,message,"cancelled","Antwort abgebrochen.",route,{})
        except (routing.Unavailable,Temporary,Rejected,psycopg.Error,TimeoutError,OSError,httpx.HTTPError,
                KeyError,IndexError,ValueError,TypeError,ApiError):
            restricted(store.finish,chat_id,message,"failed","Diese Route ist zurzeit nicht verfügbar.",
                       route,{"retryable":True})
        finally:
            app.state.chat_partials.pop(message,None)

    def start(chat_id,message):
        task=asyncio.create_task(generate(chat_id,message))
        app.state.chat_tasks[message]=task
        task.add_done_callback(lambda _:app.state.chat_tasks.pop(message,None))

    @app.post("/api/v1/intelligence/chats/{chat_id}/messages",status_code=202)
    async def send(request: Request,chat_id: UUID):
        await operator(request)
        command=await read_model(request,Message)
        text=command.text.strip()
        files=[value.hex for value in command.attachments]
        if len(set(files))!=len(files) or not text and not files:
            raise ApiError(422,"chat_message","Text oder einen Anhang hinzufügen.")
        if app.state.chat_tasks:
            raise ApiError(429,"chat_generation_busy","Eine Antwort wird bereits erzeugt.")
        message,created=restricted(store.begin,chat_id.hex,text or "Fasse diese Anhänge zusammen.",files,command.request_id.hex)
        if created:
            start(chat_id.hex,message)
        return {"id":message}

    @app.post("/api/v1/intelligence/chats/{chat_id}/messages/{message}/retry",status_code=202)
    async def retry(request: Request,chat_id: UUID,message: UUID):
        await operator(request)
        if app.state.chat_tasks:
            raise ApiError(429,"chat_generation_busy","Eine Antwort wird bereits erzeugt.")
        restricted(store.retry,chat_id.hex,message.hex)
        start(chat_id.hex,message.hex)
        return {"id":message.hex}

    @app.post("/api/v1/intelligence/chats/{chat_id}/messages/{message}/cancel")
    async def cancel(request: Request,chat_id: UUID,message: UUID):
        await operator(request)
        stopped=restricted(store.finish,chat_id.hex,message.hex,"cancelled","Antwort abgebrochen.","",{})
        if stopped and (task:=app.state.chat_tasks.get(message.hex)):
            task.cancel()
        return {"cancelled":stopped}

    @app.post("/api/v1/intelligence/chats/{chat_id}/messages/{message}/confirm")
    async def confirm(request: Request,chat_id: UUID,message: UUID):
        await operator(request)
        await read_model(request,Confirm)
        value=config()
        session_data,_,_=restricted(store.generation,chat_id.hex,message.hex,1)
        route,data=restricted(store.action_claim,chat_id.hex,message.hex)
        try:
            async with asyncio.timeout(value.timeout):
                output=await routing.apply_action(route,data,value,value.profiles[session_data["profile"]])
            state="done"
        except (routing.Unavailable,ValueError,TimeoutError,httpx.HTTPError,OSError):
            state="failed"
            output="Der Dienstaufruf konnte nicht bestätigt werden. Prüfe den Dienst vor einem weiteren Versuch."
        finally:
            # Claim remains non-repeatable after a lost client connection.
            restricted(store.finish,chat_id.hex,message.hex,locals().get("state","interrupted"),
                       locals().get("output","Ausführungsstatus unbekannt."),route,{},"acting")
        return {"state":state,"text":output}
