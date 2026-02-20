from dotenv import load_dotenv
from os import path
# Load .env from project root (where main.py lives) so LangSmith/tracing vars are always found
load_dotenv(path.join(path.dirname(path.abspath(__file__)), ".env"))

from backend import create_app
from backend.models import Document, Property, PropertyDetails, DocumentRelationship
import asyncio
import logging
import sys

logger = logging.getLogger(__name__)

app = create_app()
celery = app.extensions["celery"]

# Initialize LangGraph runtime on startup (only when running the server, not for CLI commands)
async def initialize_langgraph():
    """Start persistent LangGraph runner (single loop + compiled graph)."""
    try:
        from backend.llm.runtime.graph_runner import graph_runner
        graph_runner.start()
        graph_runner.wait_ready(timeout=15.0)
        logger.info("LangGraph GraphRunner initialized successfully on app startup")
    except Exception as e:
        logger.error(f"Failed to initialize LangGraph GraphRunner: {e}", exc_info=True)
        # Continue anyway - endpoints will fall back to legacy behavior until refactor completes

# Only initialize LangGraph when actually running the server (not for Flask CLI commands)
# Check if we're running a Flask command (db, routes, etc.) vs. starting the server
is_flask_cli = len(sys.argv) > 1 and any(arg in sys.argv[1:] for arg in ['db', 'routes', 'shell', 'init-db', 'migrate', 'upgrade', 'init'])

if not is_flask_cli:
    # Initialize LangGraph synchronously (only for server startup)
    try:
        # Create new event loop for initialization
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(initialize_langgraph())
        loop.close()
    except Exception as e:
        logger.error(f"Error initializing LangGraph: {e}", exc_info=True)
        # Continue - app can run without checkpointer

# Make celery available for Docker worker
if __name__ == '__main__':
    app.run(debug=True, port=5001, host='0.0.0.0')




