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
        assert page.evaluate("document.documentElement.scrollWidth === window.innerWidth")
        page.get_by_role("button", name="Abmelden").click()
        expect(page.get_by_label("Administrations-Token")).to_be_focused()
        assert not errors, errors
        page.close()
    browser.close()

print("Chromium: Anmeldung, Übersicht, Einstellungen, Abmeldung und responsive Ansicht geprüft.")
