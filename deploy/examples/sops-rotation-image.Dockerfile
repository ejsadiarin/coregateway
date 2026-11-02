# Image for the sops rotation jobs. Build and push once, then pin by digest
# in deploy/sops-rotation-cronjob.yaml:
#   docker build -f deploy/examples/sops-rotation-image.Dockerfile -t <registry>/jwt-rotation:0.1.0 .
#
# yq must be >= 4.30 (load_str, strenv). Alpine's `yq` package is
# mikefarah/yq; check with `yq --version` before pinning the digest.
FROM alpine:3.21

RUN apk add --no-cache \
      git openssl sops yq github-cli jq curl ca-certificates \
 && adduser -D -u 65532 runner

USER 65532
WORKDIR /work
