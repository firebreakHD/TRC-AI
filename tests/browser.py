import os
import re

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
        page.goto(url)
        page.get_by_label("Administrations-Token").fill("invalid_ui_test_00000000000000000000")
        page.get_by_role("button", name="Anmelden").click()
        expect(page.get_by_text("Ein gültiges Zugriffstoken ist erforderlich.")).to_be_visible()
        page.get_by_label("Administrations-Token").fill(token)
        page.get_by_label("Administrations-Token").press("Enter")
        expect(page.get_by_role("heading", name="Systemübersicht")).to_be_visible()
        expect(page.get_by_text("System erreichbar")).to_be_visible()
        expect(page.locator("#database")).to_have_text(re.compile(r"^18\."))
        page.get_by_role("link", name="System", exact=True).click()
        expect(page.get_by_role("heading", name="System", exact=True)).to_be_visible()
        page.get_by_label("Aktualisierungsintervall").fill("25")
        page.get_by_role("button", name="Speichern").click()
        expect(page.get_by_text("Einstellungen gespeichert.")).to_be_visible()
        page.get_by_role("link", name="Netzwerk und Integrationen").click()
        expect(page.get_by_role("heading", name="Netzwerk und Integrationen")).to_be_visible()
        expect(page.locator("#network-service")).to_have_value("trc")
        page.locator("#network-enabled").set_checked(True)
        page.get_by_role("button", name="Speichern").click()
        expect(page.get_by_text("Gespeichert. Änderungen sind sofort aktiv.")).to_be_visible()
        page.get_by_role("button", name="Gespeicherte Verbindung testen").click()
        expect(page.locator("#network-check")).to_contain_text("Dienst erreichbar.")
        page.locator("#network-service").select_option("n8n")
        page.locator("#network-auth").select_option("bearer")
        page.locator("#network-secret").fill("browser-fixture-only")
        page.get_by_role("button", name="Speichern").click()
        expect(page.get_by_text("Zugangsdaten sind gespeichert.")).to_be_visible()
        expect(page.locator("#network-secret")).to_have_value("")
        page.get_by_role("link", name="Wissensdatenbank").click()
        page.locator("#knowledge-question").fill("BLAUKOMET")
        page.get_by_role("button", name="Suchen").click()
        expect(page.locator("#knowledge-sources")).to_contain_text("BLAUKOMET")
        page.get_by_role("link", name="Dokumente", exact=True).click()
        expect(page.locator("#document-list")).to_contain_text("upload/wissen.md")
        page.get_by_role("link", name="Dienste und Datenbanken").click()
        expect(page.locator("#backend-embed")).to_contain_text("1024 Dimensionen")
        expect(page.locator("#backend-documents")).to_have_text("9")
        assert page.evaluate("document.documentElement.scrollWidth === window.innerWidth")
        page.get_by_role("button", name="Abmelden").click()
        expect(page.get_by_label("Administrations-Token")).to_be_focused()
        assert not errors, errors
        page.close()
    browser.close()

print("Chromium: Anmeldung, Übersicht, Netzwerkeinstellungen, Verbindungstest, Abmeldung und responsive Ansicht geprüft.")
