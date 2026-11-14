FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN printf 'allowBuilds:\n  esbuild: true\n' > pnpm-workspace.yaml
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# The image's entrypoint renders templates/*.template into conf.d/ with
# envsubst, and LOCAL_RESOLVERS exports NGINX_LOCAL_RESOLVERS from
# /etc/resolv.conf. GATEWAY_UPSTREAM is where /api/ goes; override it at run
# time (k3s: coregateway-api.<namespace>.svc.cluster.local:8080).
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    GATEWAY_UPSTREAM=coregateway-api:8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
