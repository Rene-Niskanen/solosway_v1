from backend import create_app
from backend.models import Document # Make sure all models are imported

app = create_app()
celery = app.extensions["celery"]

if __name__ == '__main__':
    app.run(debug=True)




