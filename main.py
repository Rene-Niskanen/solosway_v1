from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file

from backend import create_app
from backend.models import Document # Make sure all models are imported

app = create_app()
celery = app.extensions["celery"]

# Make celery available for Docker worker
if __name__ == '__main__':
    app.run(debug=True, port=5002, host='0.0.0.0')




