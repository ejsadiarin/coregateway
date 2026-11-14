# Gateway signing key: file permissions on compose and k3s

The gateway reads its Ed25519 signing key from a file (`JWT_PRIVATE_KEY_FILE`)
and runs as a non-root user with fixed IDs: **UID 10001, GID 10001**
(`Dockerfile.coregateway-api`). That user must be able to read the file, and
nobody else should. How that happens depends on where the gateway runs.

| | Docker Compose (dev machine) | k3s (homelab) |
|---|---|---|
| Where the key lives | `jwt_ed25519.pem` in the checkout (gitignored) | Secret `gateway-jwt-keys`, sops-encrypted in `core-infra` |
| How it reaches the pod | Compose `secrets:` bind-mounts the host file | Secret volume at `/etc/coregateway/jwt` |
| Who sets owner and mode | **You**, on the host file | **Kubernetes**, from `fsGroup` and `defaultMode` |
| Manual `chgrp`/`chmod` | Yes, once per machine | **No** |

## Compose: once per machine

Compose keeps the host file's owner and mode, so give the gateway's group read
access:

```sh
cd ~/personal/coregateway
sudo chgrp 10001 jwt_ed25519.pem && chmod 640 jwt_ed25519.pem
```

Do it again whenever the file is recreated: a new key, a fresh copy from
another machine, or `scp` without `-p`. If you skip it, the gateway exits at
startup with a permission error on `/run/secrets/jwt_private_key`.

## k3s: recommended steps

Nothing to run on the nodes. The pod spec does the work:

1. **Generate a new key for the cluster.** Never reuse the dev
   `jwt_ed25519.pem`. Put it in `apps/coregateway/gateway-jwt-keys.sops.yaml`
   from `deploy/examples/sops-gateway-jwt-keys-secret.yaml` and encrypt it
   ([`homelab-k3s.md`](homelab-k3s.md) §15.2).
2. **Mount it read-only with `defaultMode: 0440`** (owner and group read, no
   one else).
3. **Set the pod `securityContext`** to the image's IDs:
   ```yaml
   securityContext:
     runAsNonRoot: true
     runAsUser: 10001
     fsGroup: 10001
   ```
   `fsGroup` makes the kubelet set the mounted files' group to 10001, so
   `0440` is readable by the gateway. Without it the files are `root:root`, and
   `0440` locks the gateway out.
4. **Keep `JWT_PRIVATE_KEY_FILE`** pointing at the mounted file
   (`/etc/coregateway/jwt/private_pem`). Don't pass the PEM as an env var: env
   is readable through `/proc/1/environ` and shows up in crash dumps.
5. **Keep the Reloader annotation** (`reloader.stakater.com/auto: "true"`). The
   gateway reads the key only at boot, so a rotation needs a rollout.

The full Deployment with all of this is in [`homelab-k3s.md`](homelab-k3s.md)
§15.3. If you build it from `deploy/gateway-deployment-patch.yaml`, that patch
now carries the same pod `securityContext`.

### Check it

```sh
kubectl -n coregateway exec deploy/coregateway-api -- ls -lL /etc/coregateway/jwt/
# -r--r-----  1 root  10001  ...  private_pem
kubectl -n coregateway exec deploy/coregateway-api -- id
# uid=10001(appuser) gid=10001(appgroup) groups=10001(appgroup)
```

Then check that the gateway serves its key:
`curl -s http://coregateway-api:8080/.well-known/jwks.json` from inside the
cluster lists your `kid` (`deploy/README.md` step 1).

## If you change the image's user

`runAsUser`, `fsGroup`, the compose `chgrp` and the Dockerfile's
`addgroup`/`adduser` must all use the same IDs. Change all four together.
