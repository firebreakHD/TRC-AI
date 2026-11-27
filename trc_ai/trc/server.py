"""Run the fixed HAOS backend port with opt-in proxy trust."""

import uvicorn

from .app import app
from .network import TrustedForwarding, load_startup

if __name__ == "__main__":
    startup = load_startup()
    uvicorn.run(
        TrustedForwarding(app, startup),
        host="0.0.0.0",
        port=8099,
        access_log=False,
        proxy_headers=False,
        limit_concurrency=24,
    )
