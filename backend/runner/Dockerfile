FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends g++ gcc python3 default-jdk-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/runner
COPY runner.js ./runner.js
COPY runner/entrypoint.js ./entrypoint.js
ENV TMPDIR=/work
USER 1000:1000
# Fail the build if a damaged/cached layer cannot start a runtime.
RUN python3 -I -c "import encodings; print('Python runtime verified')" && java -version && javac -version && gcc --version && g++ --version
ENTRYPOINT ["node", "/opt/runner/entrypoint.js"]
