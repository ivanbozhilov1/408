FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN groupadd --gid 10001 picks && useradd --uid 10001 --gid 10001 --no-create-home picks \
    && mkdir /data && chown 10001:10001 /data
COPY --chown=10001:10001 server.py /app/server.py
USER 10001:10001
EXPOSE 8080
CMD ["python", "/app/server.py"]
