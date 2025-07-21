FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --default-timeout=100 --no-cache-dir -r requirements.txt

COPY . .

ENV FLASK_APP=main.py

EXPOSE 5000

CMD ["flask", "run", "--host=0.0.0.0"] 