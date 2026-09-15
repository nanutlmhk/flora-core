FROM python:3.13-slim
WORKDIR /worker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sync_worker.py .
CMD ["python", "sync_worker.py"]
