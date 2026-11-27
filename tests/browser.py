"""Visual browser smoke for chat, drag-and-drop, themes and reused administration."""
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

url = os.environ["TRC_TEST_URL"]
token = os.environ["TRC_TEST_ADMIN"]
chromium = os.environ.get("TRC_TEST_CHROMIUM")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=chromium, headless=True)
    for viewport, color in [({"width": 1440, "height": 900}, "light"),
                            ({"width": 390, "height": 844}, "dark")]:
        page = browser.new_page(viewport=viewport, color_scheme=color)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def sidebar():
            toggle = page.locator("#sidebar-toggle")
            if toggle.get_attribute("aria-expanded") == "false":
                toggle.click()

        def go(name, admin=False):
            sidebar()
            if admin and not page.locator("#administration").evaluate("(node) => node.open"):
                page.locator("#administration summary").click()
            page.get_by_role("link", name=name, exact=True).click()

        page.goto(url)
        page.get_by_label("Administrations-Token").fill("invalid_ui_test_00000000000000000000")
        page.get_by_role("button", name="Anmelden").click()
        expect(page.get_by_text("Ein gültiges Zugriffstoken ist erforderlich.")).to_be_visible()
        page.get_by_label("Administrations-Token").fill(token)
        page.get_by_label("Administrations-Token").press("Enter")
        expect(page.get_by_text("Wobei kann ich helfen?")).to_be_visible()
        assert page.locator("#administration").evaluate("(node) => !node.open")
        page.locator("#chat-profile").select_option("jarvis")
        page.locator("#chat-mode").select_option("documents")
        transfer = page.evaluate_handle(r"""() => {
            const t = new DataTransfer();
            t.items.add(new File(["# Probe\n\nBROWSERKOMET ist der Testbeleg."], "browser.md"));
            return t;
        }""")
        page.locator("#chat").dispatch_event("dragover", {"dataTransfer": transfer})
        expect(page.get_by_text("Dateien hier ablegen")).to_be_visible()
        page.locator("#chat").dispatch_event("drop", {"dataTransfer": transfer})
        expect(page.locator("#chat-files")).to_contain_text("browser.md")
        page.locator("#chat-input").fill("Fasse das Dokument zusammen.")
        page.locator("#chat-send").click()
        expect(page.locator(".message-sources summary")).to_contain_text("browser.md", timeout=18000)
        page.get_by_role("button", name="Quelle [1]").click()
        expect(page.get_by_text("BROWSERKOMET ist der Testbeleg.", exact=True)).to_be_visible()
        if path := os.environ.get("TRC_TEST_SCREENSHOTS"):
            Path(path).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(path) / f"intelligence-{color}.png"))
        sidebar()
        page.locator("#ui-theme").select_option("dark" if color == "light" else "light")
        expect(page.locator("html")).to_have_attribute("data-theme","dark" if color == "light" else "light")
        go("Übersicht", admin=True)
        expect(page.get_by_role("heading", name="Systemübersicht")).to_be_visible()
        expect(page.get_by_text("System erreichbar")).to_be_visible()
        expect(page.locator("#database")).to_have_text(re.compile(r"^18\."))
        go("Systemeinstellungen", admin=True)
        page.get_by_label("Aktualisierungsintervall").fill("25")
        page.get_by_role("button", name="Speichern").click()
        expect(page.get_by_text("Einstellungen gespeichert.")).to_be_visible()
        go("Netzwerk und Integrationen", admin=True)
        expect(page.locator("#network-service")).to_have_value("trc")
        page.locator("#network-enabled").set_checked(True)
        page.get_by_role("button",name="Speichern").click()
        expect(page.get_by_text("Gespeichert. Änderungen sind sofort aktiv.")).to_be_visible()
        page.get_by_role("button",name="Gespeicherte Verbindung testen").click()
        expect(page.locator("#network-check")).to_contain_text("Dienst erreichbar.")
        go("Wissensdatenbank")
        page.locator("#knowledge-question").fill("BLAUKOMET")
        page.get_by_role("button",name="Suchen",exact=True).click()
        expect(page.locator("#knowledge-sources")).to_contain_text("BLAUKOMET")
        go("Dokumente")
        expect(page.locator("#document-list")).to_contain_text("upload/wissen.md")
        go("Dienste, Datenbanken und Modelle", admin=True)
        expect(page.locator("#backend-embed")).to_contain_text("1024 Dimensionen")
        assert page.evaluate("document.documentElement.scrollWidth === window.innerWidth")
        sidebar()
        page.get_by_role("button",name="Abmelden").click()
        expect(page.get_by_label("Administrations-Token")).to_be_focused()
        assert not errors, errors
        page.close()
    browser.close()

print("Chromium: Chat, Drag-and-drop, Quellen, mobile Navigation, Darstellung und vorhandene Administration geprüft.")
