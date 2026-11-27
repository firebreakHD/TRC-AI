import json
import os
import sys
from time import sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

base = os.environ["TRC_TEST_URL"] + "/api/v1/"
admin = os.environ["TRC_TEST_ADMIN"]
chat = os.environ["TRC_TEST_CHAT"]
workflow = os.environ["TRC_TEST_WORKFLOW"]


def call(method, path, body=None, status=200, key=chat, idempotency=False):
    headers = {"Authorization":"Bearer "+key}
    if idempotency:
        headers["Idempotency-Key"] = str(uuid4())
    if body is not None:
        headers["Content-Type"] = "application/octet-stream" if isinstance(body,bytes) else "application/json"
        if not isinstance(body,bytes):
            body = json.dumps(body).encode()
    try:
        response = urlopen(Request(base+path,headers=headers,method=method,data=body), timeout=60)
    except HTTPError as exc:
        response = exc
    with response:
        decoded = json.load(response)
        assert response.status == status, (path,response.status,decoded)
        return decoded


def session(mode="auto", profile="general"):
    created=call("POST","intelligence/chats",{"mode":mode,"profile":profile},201)
    return "intelligence/chats/"+created["id"]


def send(path, text="", attachments=(), request=None):
    payload={"request_id": request or str(uuid4()),"text":text,"attachments":list(attachments)}
    return call("POST",path+"/messages",payload,202)["id"]


def wait(path, message):
    for _ in range(110):
        rows = call("GET",path)["messages"]
        latest=next(row for row in rows if row["id"]==message)
        if latest["state"]!="running":
            return latest
        sleep(.3)
    raise AssertionError("Antwort blieb belegt")


def tool(path, id, action, body=None, status=200):
    return call("POST",path+"/messages/"+id+"/"+action,body,status)


if sys.argv[1] == "fresh":
    assert call("GET","intelligence/session")["role"] == "chat"
    call("GET","intelligence/session",status=401,key=workflow)
    call("GET","admin/intelligence",status=401)
    call("GET","knowledge/status",status=401)
    policy = call("GET","admin/intelligence",key=admin)["policy"]
    policy["entities"] = {"Wohnzimmerlicht":"light.fixture"}
    policy["actions"] = ["light.fixture"]
    policy["automation_path"] = "/webhook/fixture"
    policy["profiles"]["general"]["tools"].append("hermes")
    call("PUT","admin/intelligence",policy,key=admin)
    for service in ("ollama","home-assistant","hermes","n8n"):
        call("PUT","admin/network/services/"+service,{"enabled":True,"internal_url":"http://127.0.0.1:11435"},key=admin)
    full = session("general","jarvis")
    uid = str(uuid4())
    ident = send(full,"VORHERTEST",request=uid)
    assert wait(full,ident)["state"] == "done"
    assert send(full,"VORHERTEST",request=uid)==ident
    row = wait(full,send(full,"KONTEXTTEST"))
    assert row["body"] == "Gesprächskontext übernommen.",row
    interrupted=send(full,"LANGSAMTEST")
    assert tool(full,interrupted,"cancel")["cancelled"]
    assert wait(full,interrupted)["state"] == "cancelled"
    rename=call("PATCH",full,{"title":"Integrationstest 0.3","profile":"friday"})
    assert rename["profile"]=="friday"
    assert call("GET","intelligence/chats?q=Integrationstest")["chats"][0]["title"]=="Integrationstest 0.3"
    temporary=call("PUT",full+"/attachments/geheim.md",b"# Vertraulich\n\nInterner Beleg PRIVATKOMET.",201)
    other=session("documents")
    call("POST",other+"/messages",{"request_id":str(uuid4()),"text":"Bitte ansehen","attachments":[temporary["id"]]},404)
    page=wait(full,send(full,"Datei zusammenfassen",[temporary["id"]]))
    assert page["route"]=="general"
    call("PATCH",full,{"mode":"documents"})
    page=wait(full,send(full,"Was steht in der Datei?"))
    assert page["sources"][0]["title"]=="geheim.md" and "PRIVATKOMET" in page["sources"][0]["excerpt"]
    assert not any("geheim.md" in row["path"] for row in call("GET","knowledge/documents",key=admin)["documents"])
    missing=wait(other,send(other,"PRIVATKOMET lesen"))
    assert not missing.get("sources")
    call("PATCH",other,{"archived":True})
    assert call("GET","intelligence/chats?archived=true")["chats"]
    call("DELETE",other)
    call("GET",other,status=404)
    reading=session("home")
    initial=wait(reading,send(reading,"Ist das Wohnzimmerlicht an?"))
    assert initial["sources"][0]["excerpt"]=="off"
    cmd=send(reading,"Schalte das Wohnzimmerlicht ein.")
    assert wait(reading,cmd)["state"]=="confirmation"
    assert tool(reading,cmd,"confirm",{"confirmed":True})["state"]=="done"
    tool(reading,cmd,"confirm",{"confirmed":True},409)
    assert wait(reading,send(reading,"Ist das Wohnzimmerlicht an?"))["sources"][0]["excerpt"]=="on"
    blocked=wait(reading,send(reading,"Schalte das Wohnzimmerlicht nicht aus."))
    assert blocked["state"]=="done" and not blocked.get("action")
    from datetime import UTC,datetime
    call("POST","workflow/records/market-prices",{
        "source":"synthetic",
        "records":[{"external_id":"gold-fixture","observed_at":datetime.now(UTC).isoformat(),
                    "payload":{"symbol":"XAU","price":4200,"currency":"USD","unit":"troy-ounce","quality":"spot"}}]
    },key=workflow, idempotency=True)
    market=session("market")
    quote=wait(market,send(market,"Wie steht Gold aktuell?"))
    assert quote.get("sources") and "4200" in quote["sources"][0]["excerpt"],quote
    knowledge=session("knowledge")
    proof=wait(knowledge,send(knowledge,"Wie lautet BLAUKOMET?"))
    assert proof.get("sources") and "BLAUKOMET" in proof["sources"][0]["excerpt"],proof
    auto=session()
    confirmation=send(auto,"Erstelle meinen Tagesbericht.")
    assert wait(auto,confirmation)["state"]=="confirmation"
    assert tool(auto,confirmation,"confirm",{"confirmed":True})["state"]=="done"
    call("PUT",full+"/attachments/global.md?kind=global",b"# Globaler Beleg\n\nGLOBALKOMET.",403)
    durable=call("PUT",full+"/attachments/global.md?kind=global",b"# Globaler Beleg\n\nGLOBALKOMET.",201,key=admin)
    for _ in range(30):
        rows=call("GET","knowledge/documents",key=admin)["documents"]
        if any(row["path"]==durable["path"] and row["state"]=="done" for row in rows):
            break
        sleep(.5)
    else:
        raise AssertionError("Dauerhafter Anhang wurde nicht indexiert")
    external=session("hermes")
    assert wait(external,send(external,"Komplexe Analyse"))["state"]=="failed"
    call("PUT","admin/network/services/ollama",{"enabled":False,"internal_url":"http://127.0.0.1:11435"},key=admin)
    direct=session("general")
    assert wait(direct,send(direct,"Frage ohne Modell"))["state"]=="failed"
    call("PUT","admin/network/services/ollama",{"enabled":True,"internal_url":"http://127.0.0.1:11435"},key=admin)
    print("Chat-Rollen, Kontext, Neustartmarker, Abbruch, private Anhänge, Archiv, HA-Quellen und sichere Aktion geprüft.")
else:
    rows=call("GET","intelligence/chats?q=Integrationstest")["chats"]
    assert rows and rows[0]["profile"]=="friday"
    saved=call("GET","intelligence/chats/"+rows[0]["id"])["messages"]
    assert any("PRIVATKOMET" in source["excerpt"] for row in saved for source in row.get("sources",[]))
    print("Persistenter Chat inklusive Quellen nach Neustart bzw. kalter Rücksicherung geprüft.")
