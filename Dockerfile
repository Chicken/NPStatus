FROM denoland/deno:alpine-1.37.0

WORKDIR /app

COPY deno* ./
COPY src/ src/
COPY public/ public/

RUN deno cache src/index.ts

CMD [ "deno", "task", "start" ]
