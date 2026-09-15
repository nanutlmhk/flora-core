FROM python:3.13-slim

WORKDIR /validator
COPY requirements.txt verify.py ./
RUN pip install --no-cache-dir -r requirements.txt

CMD ["python", "verify.py"]
