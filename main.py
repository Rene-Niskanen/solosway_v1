from dotenv import load_dotenv
load_dotenv()

from backend import create_app
from backend.models import Document, Property, PropertyDetails, DocumentRelationship
import asyncio
import logging

logger = logging.getLogger(__name__)

app = create_app()
celery = app.extensions["celery"]

# Initialize LangGraph on startup
async def initialize_langgraph():
    """Initialize LangGraph checkpointer and graph"""
    try:
        from backend.llm.graphs.main_graph import initialize_graph
        await initialize_graph()
        logger.info("✅ LangGraph initialized successfully on app startup")
    except Exception as e:
        logger.error(f"❌ Failed to initialize LangGraph: {e}", exc_info=True)
        # Continue anyway - app can still run without checkpointer

# Initialize LangGraph synchronously
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
    app.run(debug=True, port=5002, host='0.0.0.0')




