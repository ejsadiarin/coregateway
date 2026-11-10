# Homelab k3s: full setup

How to build the homelab cluster that runs coregateway, its downstream
services, and the self-hosted apps moving out of Docker Compose.

- Cluster manifests live in the **`core-infra`** repo (Flux tree). This repo
  only produces images and holds this guide.
- Immich has its own guide: [`immich-migration.md`](./immich-migration.md).
- Gateway signing-key wiring and rotation: [`deploy/README.md`](../../deploy/README.md)
  (Source B, sops + age) and [`docs/runbooks/jwt-key-rotation.md`](../runbooks/jwt-key-rotation.md).

Work top to bottom. Every phase ends with a **Verify** block; do not continue
until it passes.

- [1. Design](#1-design)
- [2. Before you start](#2-before-you-start)
- [3. Prepare the nodes](#3-prepare-the-nodes)
- [4. k3s server on the i5](#4-k3s-server-on-the-i5)
- [5. Cilium](#5-cilium)
- [6. Join the N100 as a worker](#6-join-the-n100-as-a-worker)
- [7. sops + age](#7-sops--age)
- [8. Flux](#8-flux)
- [9. Platform controllers](#9-platform-controllers)
- [10. Storage](#10-storage)
- [11. cert-manager and the wildcard certificate](#11-cert-manager-and-the-wildcard-certificate)
- [12. The two Gateways](#12-the-two-gateways)
- [13. Tailnet access and internal DNS](#13-tailnet-access-and-internal-dns)
- [14. Cloudflare Tunnel](#14-cloudflare-tunnel)
- [15. Deploying the coregateway stack](#15-deploying-the-coregateway-stack)
- [16. Moving a Compose app: ntfy](#16-moving-a-compose-app-ntfy)
- [17. Observability](#17-observability)
- [18. Backups and the restore drill](#18-backups-and-the-restore-drill)
- [19. Upgrades](#19-upgrades)
- [20. Later phases](#20-later-phases)
- [21. Troubleshooting](#21-troubleshooting)

---

## 1. Design

```
                Internet                                  Tailnet devices only
                   │                                    (laptop, phone: at home or away)
            Cloudflare edge                                       │
        *.ejsadiarin.com (proxied)                  DNS: *.lab.ejsadiarin.com
                   │ tunnel (outbound only)               → tailnet address 100.x
   ┌───────────────┼──────────────────────────────────────────────┼──────────────┐
   │        cloudflared (2 pods)                     Tailscale operator proxy    │
   │               │ http                                         │ https        │
   │      Gateway "public"                             Gateway "internal"        │
   │        core.ejsadiarin.com                        *.lab.ejsadiarin.com      │
   │          /api → coregateway-api                   LE wildcard (DNS-01)      │
   │          /    → web                               immich, ntfy, hubble, …   │
   │               │                                                             │
   │   coregateway-api ──internal token──► corefinance / coredraw / coreban      │
   │               └────────────── Neon Postgres (external) ─────────────────────│
   └─────────────────────────────────────────────────────────────────────────────┘
```

Neither Gateway has an address on the LAN. The only ways in are the Cloudflare
Tunnel (public) and the tailnet (internal). A device on the home network that
is not on the tailnet cannot reach `*.lab`.

### Decisions

| Area | Choice |
|---|---|
| Nodes | `core-1` = i5 8th gen, 16 GB (first server, embedded etcd). `core-2` = N100, 12 GB (worker; still runs the Compose stack and holds the data drives). A third node later makes all three servers |
| Kubernetes | k3s, no taint on the server; heavy pods prefer `core-1`, disk-bound pods are pinned |
| CNI | Cilium: kube-proxy replacement, Hubble, Gateway API. LB IPAM only hands the Gateways cluster-internal addresses; no L2 announcements |
| GitOps | Flux, tree in `core-infra` under `clusters/homelab` |
| Secrets | sops + age, two recipients (cluster key, personal key) |
| Internal traffic | Gateway `internal`, `*.lab.ejsadiarin.com`, Let's Encrypt wildcard. **Tailnet-only**: published by the Tailscale Kubernetes operator at its own tailnet address |
| Public traffic | Gateway `public` for `*.ejsadiarin.com` behind one wildcard DNS record and one Cloudflare Tunnel. Cloudflare's edge certificate covers every name; no router port-forward |
| Remote access | Same as local access: be on the tailnet. No subnet router |
| Storage | `longhorn` (default, 2 replicas, Retain), `local-path-retain` (node-pinned), static local PVs for existing directories |
| Databases | Neon for `coredb`; CloudNativePG in-cluster for Immich |
| Backups | Backblaze B2: one bucket for the cluster (etcd, Longhorn, CNPG), existing restic repo for Immich media. No Velero |
| Outside the cluster | AdGuard Home and Vaultwarden stay on Compose |

### Pinned versions (checked 2026-11-10)

| Component | Version | Note |
|---|---|---|
| k3s | `v1.36.6+k3s1` | **Not** 1.37: Cilium 1.20 is tested with Kubernetes 1.33–1.36 |
| Cilium (chart and CLI target) | `1.20.4` | cilium-cli `v0.20.2` |
| Gateway API CRDs | `v1.6.3` | The version Cilium 1.20 documents, not the newest release |
| Flux | `v2.10.0` | |
| cert-manager | `v1.21.3` | |
| Longhorn | `1.13.0` | |
| local-path-provisioner | `v0.0.37` | Installed by Flux, not the k3s bundled copy |
| CloudNativePG | chart `0.29.1` (operator 1.30.1) | Barman Cloud plugin chart `0.9.0` |
| kube-prometheus-stack | chart `93.1.1` | |
| Reloader | chart `2.2.19` | |
| system-upgrade-controller | `v0.21.0` | |
| cloudflared | `2026.10.7` | |
| Tailscale operator | `1.104.5` | Chart `tailscale-operator` |
| sops / age | `v3.13.3` / `v1.3.2` | |
| ntfy | `v2.37.2` | |

Before raising k3s to a new minor, check
<https://docs.cilium.io/en/stable/network/kubernetes/compatibility/>.

### Placeholders used below

| Placeholder | Meaning |
|---|---|
| `<CORE1_IP>`, `<CORE2_IP>` | Static LAN addresses of the two nodes |
| `<NIC>` | Wired interface name on a node (`ip -br link`), e.g. `enp1s0` |
| `<B2_REGION>` | B2 region of the cluster bucket, e.g. `us-west-004` |
| `<B2_CLUSTER_BUCKET>` | New bucket for etcd, Longhorn and CNPG |
| `<TUNNEL_ID>` | UUID printed by `cloudflared tunnel create` |

---

## 2. Before you start

### Workstation tools

Install on the laptop: `kubectl`, `helm`, `flux`, `cilium` (cilium-cli),
`sops`, `age`, `cloudflared`, `gh`. Only `kubectl` is present today.

### Accounts and credentials to create

| What | Where | Scope |
|---|---|---|
| Cloudflare API token `cert-manager-dns01` | Cloudflare → My Profile → API Tokens | `Zone / DNS / Edit` and `Zone / Zone / Read`, limited to the `ejsadiarin.com` zone |
| B2 bucket `<B2_CLUSTER_BUCKET>` | Backblaze | Private, default encryption on |
| B2 application key `homelab-cluster` | Backblaze | Read and write, restricted to that bucket only. It must not reach the restic bucket |
| Tailscale OAuth client `k8s-operator` | Tailscale admin → Settings → OAuth clients | Section 13.1 |
| GitHub fine-grained token for bootstrap | GitHub → Developer settings | `core-infra` only: Administration (read/write, to add the deploy key) and Contents (read/write). Delete it after bootstrap |

### Network reservations

On the router, give both nodes static DHCP leases (`<CORE1_IP>`,
`<CORE2_IP>`). Nothing else is reserved: no Gateway has a LAN address.

---

## 3. Prepare the nodes

Run on **both** Debian nodes unless noted.

```sh
sudo hostnamectl set-hostname core-1        # core-2 on the N100

sudo apt update
sudo apt install -y curl open-iscsi nfs-common cryptsetup dmsetup jq \
  unattended-upgrades
sudo systemctl enable --now iscsid
sudo dpkg-reconfigure -plow unattended-upgrades
```

`open-iscsi` and `nfs-common` are Longhorn requirements. `iptables` must also
be present: Cilium's Gateway API proxy uses it for transparent proxying unless
`bpf.tproxy` is enabled.

Kernel modules and sysctls:

```sh
cat <<'EOF' | sudo tee /etc/modules-load.d/k8s.conf
iscsi_tcp
dm_crypt
xt_socket
xt_TPROXY
EOF
sudo systemctl restart systemd-modules-load

cat <<'EOF' | sudo tee /etc/sysctl.d/90-k8s.conf
fs.inotify.max_user_instances = 8192
fs.inotify.max_user_watches   = 524288
net.ipv4.ip_forward           = 1
EOF
sudo sysctl --system
```

If `multipathd` is installed, stop it from claiming Longhorn devices:

```sh
systemctl is-active multipathd && cat <<'EOF' | sudo tee -a /etc/multipath.conf
blacklist {
    devnode "^sd[a-z0-9]+"
}
EOF
```

If a host firewall is on, allow between the two nodes: TCP 6443, 10250,
2379–2380, 4240, 4244; UDP 8472. Simplest is to trust the other node's IP.

### Data drives on `core-2` (N100 only)

The drives are mounted today by `core-infra/scripts/,mount-drive`, by hand.
Kubernetes needs them present at boot, or pods will write into empty mount
points on the root disk.

```sh
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT      # confirm labels and filesystems

cat <<'EOF' | sudo tee -a /etc/fstab
LABEL=Storage1     /mnt/Storage1     auto  defaults,nofail,x-systemd.device-timeout=30s  0 2
LABEL=Storage2     /mnt/Storage2     auto  defaults,nofail,x-systemd.device-timeout=30s  0 2
LABEL=Backups      /mnt/Backups      auto  defaults,nofail,x-systemd.device-timeout=30s  0 2
LABEL=ColdStorage  /mnt/ColdStorage  auto  defaults,nofail,x-systemd.device-timeout=30s  0 2
EOF
sudo systemctl daemon-reload && sudo mount -a && findmnt | grep /mnt
```

Replace `auto` with the real filesystem type if `mount -a` complains. `nofail`
lets the node boot with a drive missing; the static volumes in the Immich guide
add a guard so a pod cannot start against an unmounted path.

**Verify**

```sh
systemctl is-active iscsid                 # active
lsmod | grep -E 'iscsi_tcp|xt_TPROXY'      # both listed
findmnt /mnt/Storage1                      # core-2: mounted, survives a reboot
```

---

## 4. k3s server on the i5

`core-1` is bootstrapped first because nothing depends on it yet. `core-2`
keeps serving Compose apps until the platform is proven.

`/etc/rancher/k3s/config.yaml` on `core-1`:

```yaml
cluster-init: true                # embedded etcd, so more servers can join later
node-name: core-1
tls-san:
  - <CORE1_IP>
  - k3s.lab.ejsadiarin.com
write-kubeconfig-mode: "0600"
secrets-encryption: true

# Cilium replaces all of these.
flannel-backend: none
disable-network-policy: true
disable-kube-proxy: true
disable:
  - traefik
  - servicelb
  - local-storage                 # reinstalled by Flux with a Retain class

etcd-expose-metrics: true
kube-controller-manager-arg: ["bind-address=0.0.0.0"]
kube-scheduler-arg: ["bind-address=0.0.0.0"]

# etcd snapshots straight to B2 (S3 API).
etcd-snapshot-schedule-cron: "0 */6 * * *"
etcd-snapshot-retention: 28
etcd-s3: true
etcd-s3-endpoint: s3.<B2_REGION>.backblazeb2.com
etcd-s3-region: <B2_REGION>
etcd-s3-bucket: <B2_CLUSTER_BUCKET>
etcd-s3-folder: etcd
etcd-s3-access-key: <B2 keyID>
etcd-s3-secret-key: <B2 applicationKey>
```

```sh
sudo install -d -m 700 /etc/rancher/k3s
sudo chmod 600 /etc/rancher/k3s/config.yaml

curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.36.6+k3s1' sh -s - server
sudo cat /var/lib/rancher/k3s/server/token      # save: needed to join nodes and to restore
```

Copy the kubeconfig to the laptop and point it at the node:

```sh
ssh core-1 sudo cat /etc/rancher/k3s/k3s.yaml \
  | sed "s/127.0.0.1/<CORE1_IP>/" > ~/.kube/homelab.yaml
chmod 600 ~/.kube/homelab.yaml
export KUBECONFIG=~/.kube/homelab.yaml
```

**Verify**

```sh
kubectl get nodes          # core-1 is NotReady: expected, there is no CNI yet
sudo k3s etcd-snapshot save && sudo k3s etcd-snapshot ls   # one local, one s3
```

Store the server token and a copy of `config.yaml` in Vaultwarden. Both are
needed for a restore.

---

## 5. Cilium

### 5.1 Gateway API CRDs first

Cilium only enables its Gateway controller if the CRDs already exist.

```sh
GWAPI=v1.6.3
for crd in gatewayclasses gateways httproutes referencegrants grpcroutes \
           backendtlspolicies tlsroutes; do
  kubectl apply --server-side -f \
    "https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/${GWAPI}/config/crd/standard/gateway.networking.k8s.io_${crd}.yaml"
done
```

### 5.2 Install

Cilium has to exist before Flux can run, so it is installed by hand once and
adopted by Flux in section 9. Save the values as
`core-infra/infrastructure/controllers/cilium/values.yaml`; the same file feeds
both installs.

```yaml
kubeProxyReplacement: true
k8sServiceHost: <CORE1_IP>
k8sServicePort: 6443

ipam:
  operator:
    clusterPoolIPv4PodCIDRList: ["10.42.0.0/16"]   # k3s default pod CIDR

operator:
  replicas: 1                     # raise to 2 when there are three nodes
  prometheus:
    enabled: true

# The nodes run Tailscale on the host. Without this, Cilium may pick
# tailscale0 and inherit its small MTU.
devices: [<NIC>]

# Required by the Tailscale operator under kube-proxy replacement: without it,
# its proxy pods cannot forward to Service addresses.
socketLB:
  hostNamespaceOnly: true

gatewayAPI:
  enabled: true

hubble:
  relay:
    enabled: true
  ui:
    enabled: true
  metrics:
    enabled: [dns, drop, tcp, flow, icmp, http]

prometheus:
  enabled: true
```

```sh
helm repo add cilium https://helm.cilium.io && helm repo update
helm install cilium cilium/cilium --version 1.20.4 \
  --namespace kube-system -f infrastructure/controllers/cilium/values.yaml

cilium status --wait
```

`k8sServiceHost` is a single node's address. When the third server arrives,
change it to a virtual IP or a DNS name that covers all three.

### 5.3 Address pool for the Gateways

Cilium creates a `LoadBalancer` Service for every Gateway, and the Gateway is
not marked ready until that Service has an address. The pool below hands out
addresses that exist only inside the cluster: nothing announces them, so
nothing on the LAN can reach them. Saved later as
`infrastructure/configs/cilium-lb.yaml`; apply by hand for now.

```yaml
apiVersion: cilium.io/v2
kind: CiliumLoadBalancerIPPool
metadata:
  name: gateways
spec:
  blocks:
    - cidr: "172.31.255.0/28"      # any range unused on your LAN and tailnet
```

L2 announcements stay off (the chart default). If you ever want a Service
reachable from the LAN without Tailscale, that is the feature to enable, with
a pool inside `192.168.68.0/22` and a `CiliumL2AnnouncementPolicy`.

**Verify**

```sh
kubectl get nodes                               # core-1 Ready
cilium status                                   # all OK, KubeProxyReplacement: True
kubectl get gatewayclass cilium                 # ACCEPTED True
kubectl -n kube-system get ds kube-proxy        # NotFound
cilium connectivity test                        # passes (takes several minutes)
```

---

## 6. Join the N100 as a worker

Do this only after section 5 verifies. `core-2` keeps Docker and the Compose
stack; k3s uses its own containerd and the two do not share containers.

`/etc/rancher/k3s/config.yaml` on `core-2`:

```yaml
server: https://<CORE1_IP>:6443
token: <server token from section 4>
node-name: core-2
```

```sh
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.36.6+k3s1' sh -s - agent
```

Label the nodes so workloads can express a preference:

```sh
kubectl label node core-1 lab.ejsadiarin.com/class=compute
kubectl label node core-2 lab.ejsadiarin.com/class=storage
```

### Docker and Cilium on the same host

Both program packet filtering on `core-2`. What to expect:

- Traefik keeps ports 80 and 443 on the node address and AdGuard keeps 53.
  The Gateways use separate addresses, so nothing collides.
- Do not create `NodePort` or `hostPort` workloads that reuse a port Docker has
  published.
- Docker sets the `FORWARD` chain policy to `DROP`. Cilium inserts its own
  accept rules; if pod traffic through `core-2` fails after a Docker restart,
  restart the Cilium agent on that node
  (`kubectl -n kube-system delete pod -l k8s-app=cilium --field-selector spec.nodeName=core-2`).

**Verify**

```sh
kubectl get nodes -o wide                       # both Ready
cilium status                                   # 2/2 agents
cilium connectivity test                        # passes across both nodes
# On core-2: Compose apps still answer
curl -skI https://immich.local.ejsadiarin.com | head -1
```

---

## 7. sops + age

Two recipients on every secret: the cluster decrypts with one, you edit with
the other. Losing either is recoverable.

```sh
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt        # personal key, stays on the laptop
age-keygen -o cluster.agekey                     # cluster key

age-keygen -y ~/.config/sops/age/keys.txt        # → age1personal…
age-keygen -y cluster.agekey                     # → age1cluster…
```

`core-infra/.sops.yaml` (must be at the repo root):

```yaml
creation_rules:
  - path_regex: .*\.sops\.ya?ml$
    encrypted_regex: ^(data|stringData)$
    age: >-
      age1cluster…,
      age1personal…
```

Convention: every encrypted file ends in `.sops.yaml`. Only `data` and
`stringData` are encrypted, so diffs still show which Secret changed.

Give the cluster its key, then take the plaintext off the laptop:

```sh
kubectl create namespace flux-system
kubectl -n flux-system create secret generic sops-age \
  --from-file=age.agekey=cluster.agekey
```

Store `cluster.agekey` in two places **before deleting it**: Vaultwarden and a
printed copy. Then `shred -u cluster.agekey`.

Everyday use:

```sh
sops -e -i path/to/thing.sops.yaml     # encrypt in place
sops path/to/thing.sops.yaml           # edit (decrypts with the personal key)
```

Add a guard so plaintext never gets committed. In `core-infra`,
`.git/hooks/pre-commit`:

```sh
#!/bin/sh
for f in $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.sops\.ya?ml$'); do
  grep -q '^sops:' "$f" || { echo "NOT ENCRYPTED: $f"; exit 1; }
done
```

**Verify**

```sh
kubectl -n flux-system get secret sops-age
sops -d some.sops.yaml | head -3       # decrypts with the personal key
```

---

## 8. Flux

### 8.1 Repository layout

`core-infra` keeps its Compose directories; the cluster tree sits beside them.

```
core-infra/
├── .sops.yaml
├── clusters/homelab/
│   ├── flux-system/              # written by bootstrap
│   ├── infrastructure.yaml       # Kustomizations: controllers → configs
│   └── apps.yaml                 # Kustomization: apps
├── infrastructure/
│   ├── controllers/              # HelmReleases: cilium, cert-manager, longhorn, …
│   └── configs/                  # things that need those CRDs: issuers, gateways, pools
└── apps/
    ├── coregateway/
    ├── cloudflared/
    ├── ntfy/
    └── immich/
```

### 8.2 Bootstrap

```sh
export GITHUB_TOKEN=<fine-grained token from section 2>
flux check --pre
flux bootstrap github \
  --owner=ejsadiarin --repository=core-infra --personal \
  --branch=main --path=clusters/homelab
```

Bootstrap commits the Flux components and adds a read-only deploy key to the
repo. Delete the token afterwards; Flux uses the deploy key from then on.

### 8.3 The three Kustomizations

`clusters/homelab/infrastructure.yaml`:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: infra-controllers
  namespace: flux-system
spec:
  interval: 30m
  retryInterval: 2m
  timeout: 15m
  prune: true
  wait: true
  path: ./infrastructure/controllers
  sourceRef: {kind: GitRepository, name: flux-system}
  decryption:
    provider: sops
    secretRef: {name: sops-age}
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: infra-configs
  namespace: flux-system
spec:
  dependsOn: [{name: infra-controllers}]
  interval: 30m
  retryInterval: 2m
  prune: true
  wait: true
  path: ./infrastructure/configs
  sourceRef: {kind: GitRepository, name: flux-system}
  decryption:
    provider: sops
    secretRef: {name: sops-age}
```

`clusters/homelab/apps.yaml`:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: apps
  namespace: flux-system
spec:
  dependsOn: [{name: infra-configs}]
  interval: 10m
  retryInterval: 2m
  prune: true
  path: ./apps
  sourceRef: {kind: GitRepository, name: flux-system}
  decryption:
    provider: sops
    secretRef: {name: sops-age}
```

`prune: true` means deleting a file from Git deletes the object. Volumes are
protected separately by `Retain` (section 10).

**Verify**

```sh
flux check
flux get kustomizations          # flux-system Ready
```

Useful from here on: `flux get all -A`, `flux reconcile kustomization apps
--with-source`, `flux logs --level=error`.

---

## 9. Platform controllers

Each controller is a directory under `infrastructure/controllers/` with a
namespace, a `HelmRepository`, and a `HelmRelease`, listed in that directory's
`kustomization.yaml`. The pattern, shown once with cert-manager:

```yaml
# infrastructure/controllers/cert-manager/release.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cert-manager
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: jetstack
  namespace: cert-manager
spec:
  interval: 12h
  url: https://charts.jetstack.io
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: cert-manager
  namespace: cert-manager
spec:
  interval: 30m
  chart:
    spec:
      chart: cert-manager
      version: v1.21.3
      sourceRef: {kind: HelmRepository, name: jetstack}
  install:
    crds: CreateReplace
    remediation: {retries: 3}
  upgrade:
    crds: CreateReplace
    remediation: {retries: 3}
  values:
    crds:
      enabled: true
    config:
      apiVersion: controller.config.cert-manager.io/v1alpha1
      kind: ControllerConfiguration
      enableGatewayAPI: true
    # DNS-01 self-check must not be answered by AdGuard's rewrite.
    dns01RecursiveNameserversOnly: true
    dns01RecursiveNameservers: "1.1.1.1:53,1.0.0.1:53"
```

The full set:

| Directory | Chart (repository) | Version | Namespace | Values that matter |
|---|---|---|---|---|
| `cilium` | `cilium` (`https://helm.cilium.io`) | `1.20.4` | `kube-system` | The `values.yaml` from section 5, loaded with `valuesFrom` a ConfigMap generated by kustomize. Release name must stay `cilium` so Flux adopts the manual install |
| `cert-manager` | `cert-manager` (`https://charts.jetstack.io`) | `v1.21.3` | `cert-manager` | Above |
| `local-path` | Plain manifests, see section 10 | `v0.0.37` | `local-path-storage` | |
| `longhorn` | `longhorn` (`https://charts.longhorn.io`) | `1.13.0` | `longhorn-system` | Section 10 |
| `tailscale` | `tailscale-operator` (`https://pkgs.tailscale.com/helmcharts`) | `1.104.5` | `tailscale` | Section 13.1 |
| `reloader` | `reloader` (`https://stakater.github.io/stakater-charts`) | `2.2.19` | `reloader` | Defaults |
| `cnpg` | `cloudnative-pg` (`https://cloudnative-pg.github.io/charts`) | `0.29.1` | `cnpg-system` | Defaults |
| `cnpg-barman` | `plugin-barman-cloud` (same repository) | `0.9.0` | `cnpg-system` | Needs cert-manager; add `dependsOn` |
| `monitoring` | `kube-prometheus-stack` (`https://prometheus-community.github.io/helm-charts`) | `93.1.1` | `monitoring` | Section 17 |
| `system-upgrade` | Plain manifests from the release page | `v0.21.0` | `system-upgrade` | Section 19 |

Adopting Cilium: when the `HelmRelease` named `cilium` in `kube-system`
reconciles, Flux upgrades the existing Helm release in place. Confirm with
`flux get helmrelease -n kube-system cilium` and `cilium status`; there should
be no agent restart storm if the values are identical.

**Verify**

```sh
flux get helmreleases -A         # all Ready
kubectl get pods -A | grep -v Running | grep -v Completed   # nothing stuck
```

---

## 10. Storage

| Class | Backed by | Reclaim | Use for |
|---|---|---|---|
| `longhorn` (default) | Longhorn, 2 replicas (one per node) | Retain | Anything that should survive a node loss and follow a pod between nodes |
| `local-path-retain` | A directory on one node's SSD | Retain | Data tied to one node where local speed matters (Immich's database) |
| Static local PV | An existing directory | Retain | Data that already exists and must stay as plain files (Immich library) |

`Retain` means deleting a claim never deletes data. The cost is manual
cleanup: a released volume stays until you delete it.

### 10.1 local-path with a Retain class

k3s's bundled copy is disabled (section 4) because its only class deletes data
with the claim and k3s re-applies its own manifest on every restart.

```yaml
# infrastructure/controllers/local-path/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.37/deploy/local-path-storage.yaml
  - storageclass-retain.yaml
```

```yaml
# infrastructure/controllers/local-path/storageclass-retain.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path-retain
provisioner: rancher.io/local-path
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
```

Volumes land under `/opt/local-path-provisioner` on whichever node the pod is
scheduled to, and the pod is then tied to that node.

### 10.2 Longhorn

`HelmRelease` values:

```yaml
persistence:
  defaultClass: true
  defaultClassReplicaCount: 2
  reclaimPolicy: Retain
defaultSettings:
  defaultReplicaCount: 2
  defaultDataPath: /var/lib/longhorn
  replicaSoftAntiAffinity: false            # never both replicas on one node
  storageMinimalAvailablePercentage: 25     # stop scheduling before the OS disk fills
  storageOverProvisioningPercentage: 100
  nodeDownPodDeletionPolicy: delete-both-statefulset-and-deployment-pod
defaultBackupStore:
  backupTarget: s3://<B2_CLUSTER_BUCKET>@<B2_REGION>/longhorn
  backupTargetCredentialSecret: b2-longhorn
```

Credentials, as `infrastructure/controllers/longhorn/b2.sops.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: b2-longhorn
  namespace: longhorn-system
stringData:
  AWS_ACCESS_KEY_ID: <B2 keyID>
  AWS_SECRET_ACCESS_KEY: <B2 applicationKey>
  AWS_ENDPOINTS: https://s3.<B2_REGION>.backblazeb2.com
```

Longhorn stores replicas on the root SSDs under `/var/lib/longhorn`. Both
disks are 512 GB and shared with the OS, so the 25 % floor matters.

Nightly backup of every volume, as `infrastructure/configs/longhorn-backup.yaml`:

```yaml
apiVersion: longhorn.io/v1beta2
kind: RecurringJob
metadata:
  name: nightly-b2
  namespace: longhorn-system
spec:
  task: backup
  cron: "30 2 * * *"
  retain: 14
  concurrency: 1
  groups: [default]          # "default" applies to every volume with no explicit job
```

**Verify**

```sh
kubectl get storageclass          # longhorn (default), local-path, local-path-retain
kubectl -n longhorn-system get nodes.longhorn.io    # both Ready, Schedulable
# Throwaway claim: bind, write, back up, delete
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: probe, namespace: default}
spec: {accessModes: [ReadWriteOnce], resources: {requests: {storage: 1Gi}}}
EOF
kubectl get pvc probe             # Bound, 2 healthy replicas in the Longhorn UI
```

Trigger one backup from the Longhorn UI and confirm objects appear under
`longhorn/` in the bucket. Then delete the claim **and** the released volume.

---

## 11. cert-manager and the wildcard certificate

The internal wildcard is issued over DNS-01, so nothing has to be reachable
from the internet. Cloudflare's own edge certificate covers the public name.

`infrastructure/configs/cloudflare-token.sops.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cloudflare-api-token
  namespace: cert-manager
stringData:
  api-token: <cert-manager-dns01 token>
```

`infrastructure/configs/issuers.yaml`:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: <your email>
    privateKeySecretRef: {name: letsencrypt-staging-account}
    solvers:
      - dns01:
          cloudflare:
            apiTokenSecretRef: {name: cloudflare-api-token, key: api-token}
        selector:
          dnsZones: [ejsadiarin.com]
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <your email>
    privateKeySecretRef: {name: letsencrypt-prod-account}
    solvers:
      - dns01:
          cloudflare:
            apiTokenSecretRef: {name: cloudflare-api-token, key: api-token}
        selector:
          dnsZones: [ejsadiarin.com]
```

`infrastructure/configs/wildcard-cert.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: gateway
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: lab-wildcard
  namespace: gateway
spec:
  secretName: lab-wildcard-tls
  issuerRef: {kind: ClusterIssuer, name: letsencrypt-staging}   # switch to prod once Ready
  dnsNames:
    - lab.ejsadiarin.com
    - "*.lab.ejsadiarin.com"
```

Start on staging: production has strict rate limits and a misconfigured token
burns them quickly. When the staging certificate is `Ready`, change the issuer
to `letsencrypt-prod`, push, and delete the old Secret so it is re-issued.

**Verify**

```sh
kubectl get clusterissuer                              # both Ready True
kubectl -n gateway get certificate lab-wildcard        # Ready True (1–3 minutes)
kubectl -n gateway describe challenge                  # empty once solved
```

---

## 12. The two Gateways

`infrastructure/configs/gateways.yaml`:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: internal
  namespace: gateway
spec:
  gatewayClassName: cilium
  infrastructure:
    annotations:
      # Copied onto the Gateway's Service: the Tailscale operator publishes it
      # to the tailnet as the device "lab".
      tailscale.com/expose: "true"
      tailscale.com/hostname: lab
      tailscale.com/tags: "tag:k8s"
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces: {from: Same}               # only the redirect below
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.lab.ejsadiarin.com"
      tls:
        mode: Terminate
        certificateRefs: [{name: lab-wildcard-tls}]
      allowedRoutes:
        namespaces: {from: All}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
  namespace: gateway
spec:
  parentRefs: [{name: internal, sectionName: http}]
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect: {scheme: https, statusCode: 301}
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public
  namespace: gateway
spec:
  gatewayClassName: cilium
  # No Tailscale annotations: reachable only from inside the cluster,
  # which in practice means the cloudflared pods.
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      hostname: "*.ejsadiarin.com"
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              lab.ejsadiarin.com/public: "true"
```

Notes:

- Cilium creates a Service per Gateway named `cilium-gateway-<name>`. The
  tunnel targets `cilium-gateway-public.gateway.svc.cluster.local:80`.
- The public listener is plain HTTP: TLS ends at Cloudflare and the tunnel is
  encrypted end to end. Nothing on the LAN can reach that listener.
- The public listener accepts any `*.ejsadiarin.com` name, and a wildcard DNS
  record points all of them at the tunnel (section 14.4). A name is live only
  once an `HTTPRoute` claims it.
- A namespace can attach routes to `public` only if it carries the
  `lab.ejsadiarin.com/public: "true"` label. An app is public by an explicit
  act, never by accident.
- To expose an app internally, add an `HTTPRoute` in its namespace with
  `parentRefs: [{name: internal, namespace: gateway, sectionName: https}]`.

Exposing Hubble UI as the first internal route
(`infrastructure/configs/hubble-route.yaml`):

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: hubble-ui
  namespace: kube-system
spec:
  parentRefs: [{name: internal, namespace: gateway, sectionName: https}]
  hostnames: [hubble.lab.ejsadiarin.com]
  rules:
    - backendRefs: [{name: hubble-ui, port: 80}]
```

Hubble UI and the Longhorn UI (`longhorn-frontend:80` in `longhorn-system`)
have no login. They are protected by the internal Gateway being tailnet-only;
see section 20 for adding a login on top.

**Verify**

```sh
kubectl -n gateway get gateway
# internal  PROGRAMMED True  ADDRESS 172.31.255.x
# public    PROGRAMMED True  ADDRESS 172.31.255.x

# From inside the cluster, before Tailscale and DNS exist:
kubectl run probe --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sI --resolve hubble.lab.ejsadiarin.com:443:<internal ADDRESS> \
  https://hubble.lab.ejsadiarin.com                    # 200, valid certificate
```

---

## 13. Tailnet access and internal DNS

The internal Gateway is reachable only over Tailscale. That is true at home as
well: a device must be signed in to the tailnet to open any `*.lab` address.
On the same network Tailscale connects devices directly, so there is no speed
penalty at home.

Tailscale already runs on your devices and on the nodes. That makes the
**nodes** reachable over the tailnet, but the Gateway is not a node: it is a
virtual Service address inside the cluster. Something has to give that Service
a tailnet address of its own. The Tailscale Kubernetes operator does exactly
that, and nothing more is needed: no subnet router, no advertised routes.

### 13.1 Tailscale operator

In the Tailscale admin console:

1. **Access controls**: add the two tags the operator uses.

   ```json
   "tagOwners": {
     "tag:k8s-operator": [],
     "tag:k8s":          ["tag:k8s-operator"]
   }
   ```

2. **Settings → OAuth clients → Generate**: scopes `Devices: Core` (write) and
   `Keys: Auth Keys` (write), tag `tag:k8s-operator`. Save the client ID and
   secret.

Check both steps against the operator quickstart
(<https://tailscale.com/kb/1236/kubernetes-operator>); scope names in the
console change from time to time.

`infrastructure/controllers/tailscale/oauth.sops.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: operator-oauth
  namespace: tailscale
stringData:
  client_id: <OAuth client ID>
  client_secret: <OAuth client secret>
```

The `HelmRelease` (chart `tailscale-operator`, repository
`https://pkgs.tailscale.com/helmcharts`, version `1.104.5`, namespace
`tailscale`) needs no values: the chart reads the Secret named
`operator-oauth` when no credentials are passed inline.

Once it runs, the operator sees the `tailscale.com/expose` annotation on
`cilium-gateway-internal`, starts a small proxy pod, and registers it on the
tailnet as the device **`lab`**.

```sh
kubectl -n tailscale get pods                 # operator + one ts-cilium-gateway-internal-… proxy
tailscale status | grep -w lab                # 100.x.y.z  lab  tagged-devices
```

Write down that `100.x.y.z` address: it is `<LAB_TS_IP>` below. It stays the
same as long as the proxy's state Secret in the `tailscale` namespace exists.

### 13.2 Who on the tailnet may connect

By default your access rules probably allow every device of yours to reach
every other. To be explicit, grant only the Gateway's ports:

```json
"grants": [
  {"src": ["autogroup:member"], "dst": ["tag:k8s"], "ip": ["tcp:443", "tcp:80"]}
]
```

Devices you share the tailnet with can then be included or left out by
changing `src`.

### 13.3 DNS

Every `*.lab` name must resolve to `<LAB_TS_IP>`. Two ways; pick one.

**A. AdGuard rewrite plus Tailscale split DNS (keeps the names private).**

In AdGuard Home on `core-2`, **Filters → DNS rewrites → Add**:

| Domain | Answer |
|---|---|
| `*.lab.ejsadiarin.com` | `<LAB_TS_IP>` |
| `lab.ejsadiarin.com` | `<LAB_TS_IP>` |

Then in the Tailscale admin console, **DNS → Nameservers → Add → Custom**:
`core-2`'s tailnet address, with **Restrict to domain** set to
`lab.ejsadiarin.com`. Tailnet devices now ask AdGuard for `*.lab` wherever
they are. AdGuard must listen on the tailnet interface for this to work away
from home; its Compose file publishes port 53 on all addresses, so it does.

**B. One public DNS record (fewer moving parts).**

In Cloudflare DNS: `*.lab` → `A` → `<LAB_TS_IP>`, **DNS only** (grey cloud).
The address is in Tailscale's private range and is useless to anyone off your
tailnet, but the name and address are publicly visible. Internal DNS no longer
depends on AdGuard or on `core-2` being up.

The existing `*.local.ejsadiarin.com` rewrite to Traefik stays until Traefik
is empty.

**Verify**

```sh
dig +short hubble.lab.ejsadiarin.com            # <LAB_TS_IP>
curl -sI https://hubble.lab.ejsadiarin.com | head -1     # 200, valid certificate
tailscale down && curl -m5 -sI https://hubble.lab.ejsadiarin.com; tailscale up
#   times out with Tailscale off, even on the home network
```

Repeat the last check from a phone on mobile data with Tailscale on: the page
loads.

### 13.4 What "tailnet-only" does and does not guarantee

- Nothing announces the Gateway's `172.31.255.x` address, so ordinary LAN
  devices have no route to it.
- A LAN device whose owner deliberately adds a static route for that range
  through a node could still reach the listener, because Cilium accepts
  traffic for load-balancer addresses on the node's network card. Closing that
  fully takes a Cilium policy on the reserved `ingress` identity that admits
  only in-cluster sources. Treat that as a hardening step for later and test
  it carefully: the same policy governs the public Gateway.
- All internal traffic passes through one proxy pod. If its node goes down the
  pod is rescheduled and keeps its address; expect about a minute of
  interruption.

---

## 14. Cloudflare Tunnel

One tunnel carries every public hostname to the `public` Gateway. Routing
between apps happens in `HTTPRoute`s, in Git, not in the Cloudflare dashboard.

```
browser → Cloudflare edge (TLS) → tunnel → cloudflared pod → Gateway "public" → HTTPRoute → Service
```

The tunnel connects outbound from the cluster. No port is opened on the router.

### 14.1 Create the tunnel (laptop)

```sh
cloudflared tunnel login                 # browser opens; pick the ejsadiarin.com zone
cloudflared tunnel create homelab        # prints <TUNNEL_ID>, writes ~/.cloudflared/<TUNNEL_ID>.json
```

`login` writes `~/.cloudflared/cert.pem`, an account-level credential used
only to create tunnels and DNS routes. The cluster needs only the per-tunnel
JSON file.

### 14.2 Credentials into Git, encrypted

```sh
cd core-infra
kubectl create secret generic cloudflared-credentials -n cloudflared \
  --from-file=credentials.json=$HOME/.cloudflared/<TUNNEL_ID>.json \
  --dry-run=client -o yaml > apps/cloudflared/credentials.sops.yaml
sops -e -i apps/cloudflared/credentials.sops.yaml
```

Keep a copy of the JSON file in Vaultwarden, then delete it and `cert.pem`
from the laptop.

### 14.3 Deployment

`apps/cloudflared/cloudflared.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cloudflared
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cloudflared
  namespace: cloudflared
data:
  config.yaml: |
    tunnel: <TUNNEL_ID>
    credentials-file: /etc/cloudflared/creds/credentials.json
    metrics: 0.0.0.0:2000
    no-autoupdate: true
    ingress:
      # Every hostname pointed at this tunnel goes to the public Gateway,
      # which decides by Host header. Unknown hosts get the Gateway's 404.
      - service: http://cilium-gateway-public.gateway.svc.cluster.local:80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
  namespace: cloudflared
  annotations:
    reloader.stakater.com/auto: "true"
spec:
  replicas: 2
  selector:
    matchLabels: {app: cloudflared}
  template:
    metadata:
      labels: {app: cloudflared}
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: {app: cloudflared}
      securityContext:
        sysctls:
          - {name: net.ipv4.ping_group_range, value: "65532 65532"}
      containers:
        - name: cloudflared
          image: cloudflare/cloudflared:2026.10.7
          args: [tunnel, --config, /etc/cloudflared/config/config.yaml, run]
          livenessProbe:
            httpGet: {path: /ready, port: 2000}
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          resources:
            requests: {cpu: 20m, memory: 64Mi}
            limits: {memory: 256Mi}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 65532
            capabilities: {drop: [ALL]}
          volumeMounts:
            - {name: config, mountPath: /etc/cloudflared/config, readOnly: true}
            - {name: creds, mountPath: /etc/cloudflared/creds, readOnly: true}
      volumes:
        - name: config
          configMap: {name: cloudflared}
        - name: creds
          secret: {secretName: cloudflared-credentials}
```

Two replicas, one per node, each holding its own connections to Cloudflare.
Either node can go down without the public site going with it.

### 14.4 Wildcard DNS record

One proxied wildcard record sends every `<name>.ejsadiarin.com` to the tunnel:

```sh
cloudflared tunnel route dns homelab '*.ejsadiarin.com'
```

Or by hand in the dashboard: `*` → `CNAME` → `<TUNNEL_ID>.cfargotunnel.com`,
proxied (orange cloud).

This is the equivalent of the Traefik wildcard setup, with one difference in
who holds the certificate: Cloudflare's edge certificate already covers
`*.ejsadiarin.com` and renews itself. cert-manager is not involved on the
public side at all; it only issues the `*.lab` certificate.

How the wildcard behaves:

- **A name is live only when a route claims it.** A name with no `HTTPRoute`
  reaches the Gateway and gets its 404. Publishing an app is therefore a
  change in Git (section 14.8), never a DNS change.
- **Explicit records win.** Any record you already have for a specific name
  (mail, verification records, anything not meant for the cluster) keeps
  working; the wildcard only answers names that have no record of their own.
  Review the zone's existing records once before adding it.
- **One level only.** `app.ejsadiarin.com` is covered; `a.b.ejsadiarin.com`
  is not, by either the record or the free certificate. `*.lab` and `*.local`
  are unaffected for the same reason.
- **The bare name `lab.ejsadiarin.com`** matches the wildcard and would get
  the public Gateway's 404. Harmless; internal apps live at `<app>.lab…`.

### 14.5 Zone settings

| Setting | Value | Why |
|---|---|---|
| SSL/TLS → Overview | **Full** | Applies to the zone's other records; tunnel traffic is encrypted regardless |
| SSL/TLS → Edge Certificates → Always Use HTTPS | On | No plaintext hop from the browser |
| Security → WAF → Rate limiting rules | Section 14.6 | The gateway cannot see real client IPs behind the tunnel |
| Security → Bots → Bot Fight Mode | On | Free tier |

### 14.6 Rate-limit the credential endpoints

Free plans allow one rate-limiting rule. Login, register, demo login and key
creation all sit under `/api/auth/` (`internal/server/routes.go`):

- **When incoming requests match**: `http.host eq "core.ejsadiarin.com" and
  starts_with(http.request.uri.path, "/api/auth/")`
- **Characteristics**: IP
- **Rate**: 10 requests per 10 seconds
- **Action**: Block for 10 seconds (the free-plan maximum)

With one rule and many public apps, widen the match instead of naming one
host: drop the `http.host` condition and match the login paths of every app
with `or`. Apps the rule cannot cover should sit behind Cloudflare Access
(section 14.8).

### 14.7 Limits to know

- The free plan rejects request bodies over **100 MB**. Fine for this app; the
  reason Immich is not published through the tunnel.
- WebSockets work with no extra setting (corefinance uses one).
- Requests arrive at the gateway from the `cloudflared` pod. The real client
  address is in the `CF-Connecting-IP` header; the gateway does not read it
  today, so its logs show pod addresses.

### 14.8 Publishing another app

Three steps, all in `core-infra`. No Cloudflare or DNS change.

1. Label the app's namespace, which is the explicit act that allows it to
   attach to the public Gateway:

   ```yaml
   metadata:
     labels:
       lab.ejsadiarin.com/public: "true"
   ```

2. Add a route with the hostname you want:

   ```yaml
   apiVersion: gateway.networking.k8s.io/v1
   kind: HTTPRoute
   metadata:
     name: myapp-public
     namespace: myapp
   spec:
     parentRefs: [{name: public, namespace: gateway}]
     hostnames: [myapp.ejsadiarin.com]
     rules:
       - backendRefs: [{name: myapp, port: 8080}]
   ```

3. Push. The name answers as soon as Flux reconciles.

An app can be on both Gateways at once: one route to `public` with
`myapp.ejsadiarin.com`, another to `internal` with `myapp.lab.ejsadiarin.com`.

Before publishing anything, ask what protects it. Everything behind this
Gateway is on the open internet:

- An app with solid built-in login (coregateway) can stand on its own, with
  the rate-limit rule.
- An app with weak or no login should get **Cloudflare Access** in front:
  Zero Trust → Access → Applications → Self-hosted, hostname
  `myapp.ejsadiarin.com`, policy "emails matching yours". The free plan covers
  50 users. Requests are then authenticated at Cloudflare's edge before they
  ever reach the tunnel.
- Admin dashboards (Hubble, Longhorn, Grafana) belong on the internal Gateway
  only.

One hostname can also serve several services by path, which is what
`core.ejsadiarin.com` does with `/api` and `/`. Use that for parts of one
application. Separate applications get separate hostnames, so their cookies
and browser storage stay isolated from each other.

**Verify** (after section 15 has attached a route)

```sh
kubectl -n cloudflared get pods -o wide          # 2 Running, one per node
kubectl -n cloudflared logs deploy/cloudflared | grep -c 'Registered tunnel connection'   # ≥ 4
cloudflared tunnel info homelab                  # connectors listed
dig +short anything-at-all.ejsadiarin.com        # Cloudflare addresses: wildcard is live
curl -sI https://core.ejsadiarin.com | head -1   # 200 from anywhere, including mobile data
curl -sI https://not-a-real-app.ejsadiarin.com | head -1   # 404 from the Gateway
```

Then confirm nothing is exposed directly: the router has no port-forward, and
`curl -m5 http://<your public IP>` times out.

---

## 15. Deploying the coregateway stack

Six workloads in one namespace, as plain manifests under
`core-infra/apps/coregateway/`.

| Workload | Kind | Image | Port |
|---|---|---|---|
| `coregateway-api` | Deployment | `ghcr.io/ejsadiarin/coregateway-api` | 8080 |
| `web` | Deployment | `ghcr.io/ejsadiarin/coregateway-web` | 80 |
| `corefinance-api` | Deployment | `ghcr.io/ejsadiarin/corefinance-api` | 6969 |
| `coredraw-api` | Deployment | `ghcr.io/ejsadiarin/coredraw-api` | 6971 |
| `coreban-api` | Deployment | `ghcr.io/ejsadiarin/coreban-api` | 6972 |
| `corefinance-worker` | CronJob (`--once`) | `ghcr.io/ejsadiarin/corefinance-cron-worker` | none |

Service names are part of a contract: the `web` image's `nginx.conf` proxies
to `coregateway-api:8080` and nginx refuses to start if that name does not
resolve. Keep the Service named `coregateway-api`. The older templates in
`deploy/` use the placeholder name `gateway`; rename when folding them in.

### 15.1 Build and push images

None of the four repos builds an image today. Add one workflow per repo;
this is the gateway's (`.github/workflows/image.yml`):

```yaml
name: image
on:
  push:
    branches: [main]
    tags: ["v*"]
permissions:
  contents: read
  packages: write
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - {name: coregateway-api, context: ., file: Dockerfile.coregateway-api}
          - {name: coregateway-web, context: ./web, file: web/Dockerfile}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/${{ matrix.name }}
          tags: |
            type=sha,format=short,prefix=sha-
            type=semver,pattern={{version}}
      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.file }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

The gateway repo does not need submodules checked out: its Dockerfile builds
only `./cmd/coregateway`. Verify that once with a clean clone, because
`go.work` references the submodule paths.

For the downstream repos, set `target` to the stage each Compose service uses
(`api`, `worker`).

While you are in the Dockerfiles: replace `FROM alpine:latest` with a pinned
tag. A floating base makes two builds of the same commit differ.

Private packages need a pull secret in the namespace
(`apps/coregateway/ghcr.sops.yaml`, type `kubernetes.io/dockerconfigjson`,
from a token with `read:packages`) and `imagePullSecrets` on each pod. Public
packages need nothing.

### 15.2 Namespace and secrets

```yaml
# apps/coregateway/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: coregateway
  labels:
    lab.ejsadiarin.com/public: "true"      # may attach routes to the public Gateway
```

One encrypted Secret per workload, holding only what that workload needs:

```yaml
# apps/coregateway/coregateway-api.sops.yaml
apiVersion: v1
kind: Secret
metadata:
  name: coregateway-api
  namespace: coregateway
stringData:
  DATABASE_URL: postgresql://coregateway_role:…@<pooler-host>/coredb?sslmode=require
  ADMIN_EMAIL: …
  ADMIN_PASSWORD: …
```

Only `DATABASE_URL` (the pooled, DML-only role) goes into the cluster.
`MIGRATION_URL` is the database owner and stays on the laptop; see 15.6.

The signing key is a separate Secret, `gateway-jwt-keys`, with the four keys
`private_pem`, `kid`, `prev_private_pem`, `prev_kid`. Create it from
`deploy/examples/sops-gateway-jwt-keys-secret.yaml`:

```sh
openssl genpkey -algorithm ed25519 -out /tmp/new.pem
cp ~/personal/coregateway/deploy/examples/sops-gateway-jwt-keys-secret.yaml \
   apps/coregateway/gateway-jwt-keys.sops.yaml
$EDITOR apps/coregateway/gateway-jwt-keys.sops.yaml     # paste the PEM, set kid
sops -e -i apps/coregateway/gateway-jwt-keys.sops.yaml
shred -u /tmp/new.pem
```

Generate a **new** key for the cluster. Do not reuse `jwt_ed25519.pem` from
the dev checkout.

### 15.3 The gateway

```yaml
# apps/coregateway/coregateway-api.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coregateway-api
  namespace: coregateway
  annotations:
    reloader.stakater.com/auto: "true"      # roll on any Secret change (key rotation)
spec:
  replicas: 2
  selector:
    matchLabels: {app: coregateway-api}
  template:
    metadata:
      labels: {app: coregateway-api}
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: {app: coregateway-api}
      containers:
        - name: coregateway-api
          image: ghcr.io/ejsadiarin/coregateway-api:sha-<short>
          ports: [{containerPort: 8080}]
          envFrom:
            - secretRef: {name: coregateway-api}
          env:
            - {name: PORT, value: "8080"}
            - {name: ENV, value: production}          # exact string: makes the session cookie Secure
            - {name: ALLOWED_ORIGINS, value: "https://core.ejsadiarin.com"}
            - {name: COREFINANCE_URL, value: "http://corefinance-api:6969"}
            - {name: COREDRAW_URL, value: "http://coredraw-api:6971"}
            - {name: COREBAN_URL, value: "http://coreban-api:6972"}
            - {name: JWT_ISSUER, value: "https://gateway.internal"}
            - {name: JWT_AUDIENCE, value: "corefinance,coredraw,coreban"}
            - {name: JWT_TTL_SECONDS, value: "300"}
            - {name: JWT_PRIVATE_KEY_FILE, value: /etc/coregateway/jwt/private_pem}
            - {name: JWT_PREV_PRIVATE_KEY_FILE, value: /etc/coregateway/jwt/prev_private_pem}
            - name: JWT_KID
              valueFrom: {secretKeyRef: {name: gateway-jwt-keys, key: kid}}
            - name: JWT_PREV_KID
              valueFrom: {secretKeyRef: {name: gateway-jwt-keys, key: prev_kid}}
          readinessProbe:
            httpGet: {path: /.well-known/jwks.json, port: 8080}
            periodSeconds: 5
          livenessProbe:
            httpGet: {path: /health, port: 8080}
            periodSeconds: 10
          resources:
            requests: {cpu: 25m, memory: 64Mi}
            limits: {memory: 256Mi}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: {drop: [ALL]}
          volumeMounts:
            - {name: jwt-keys, mountPath: /etc/coregateway/jwt, readOnly: true}
      volumes:
        - name: jwt-keys
          secret: {secretName: gateway-jwt-keys, defaultMode: 0440}
      securityContext:
        runAsNonRoot: true
        runAsUser: 100
        fsGroup: 101
---
apiVersion: v1
kind: Service
metadata:
  name: coregateway-api
  namespace: coregateway
spec:
  selector: {app: coregateway-api}
  ports: [{port: 8080, targetPort: 8080}]
```

The image runs as a non-root user created by `adduser -S`; confirm its numeric
ID with `docker run --rm <image> id` and set `runAsUser`/`fsGroup` to match, or
the key file will be unreadable and the gateway will refuse to start.

Two replicas are safe only if sessions live in Postgres, which they do
(a stored session record). Rate limits or caches held in process memory would
not be shared.

### 15.4 Web and downstream services

`web` is a two-replica Deployment of the nginx image with a Service on port 80
and no environment. It needs a writable `/var/cache/nginx` and `/var/run`
(`emptyDir`) if you set a read-only root filesystem.

Each downstream follows the gateway's shape with these differences:

```yaml
env:
  - {name: PORT, value: "6972"}                       # per service
  - {name: JWT_ISSUER, value: "https://gateway.internal"}
  - {name: JWT_AUDIENCE, value: coreban}              # its own name, never the list
  - name: JWT_JWKS_URL
    value: http://coregateway-api.coregateway.svc.cluster.local:8080/.well-known/jwks.json
readinessProbe:
  httpGet: {path: /health, port: 6972}
```

A downstream fails to boot if the JWKS URL is unreachable, so on a cold start
its pods restart until the gateway is ready. That is expected and settles in
under a minute.

coreban also takes `NTFY_URL` and `NTFY_TOKEN`; point `NTFY_URL` at
`http://ntfy.ntfy.svc.cluster.local` once section 16 is done.

The worker:

```yaml
# apps/coregateway/corefinance-worker.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: corefinance-worker
  namespace: coregateway
spec:
  schedule: "5 0 * * *"
  timeZone: Asia/Manila
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: worker
              image: ghcr.io/ejsadiarin/corefinance-cron-worker:sha-<short>
              args: ["--once"]
              envFrom:
                - secretRef: {name: corefinance}
```

### 15.5 Routes

```yaml
# apps/coregateway/route.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: core
  namespace: coregateway
spec:
  parentRefs: [{name: public, namespace: gateway}]
  hostnames: [core.ejsadiarin.com]
  rules:
    - matches:
        - path: {type: PathPrefix, value: /api}
      backendRefs: [{name: coregateway-api, port: 8080}]
      timeouts: {request: 60s}
    - matches:
        - path: {type: PathPrefix, value: /}
      backendRefs: [{name: web, port: 80}]
```

API calls go straight from the Gateway to `coregateway-api`. The `/api` block
in `web/nginx.conf` is no longer on the request path; it can stay in the image
as long as the Service name resolves.

### 15.6 Database migrations

Nothing migrates at boot. Before pushing a manifest that bumps an image tag:

```sh
# In the repo being released, with MIGRATION_URL (owner role, direct host) in .env
make migrate-status
make migrate-up
```

Then push the tag bump. Migrations must be backward compatible with the
running version, because old pods serve traffic until the new ones are ready.

### 15.7 Network policy

`deploy/cilium-networkpolicy.yaml` is the starting point: each downstream
accepts ingress only from the gateway. Three things it needs in this cluster:

1. Fix the labels (`app: coregateway-api`, `app: corefinance-api`, …) and ports.
2. Traffic that arrives through a Gateway does **not** carry the client pod's
   identity. Cilium marks it as the reserved `ingress` entity. Once any policy
   selects the gateway or web pods, they must allow it:

   ```yaml
   apiVersion: cilium.io/v2
   kind: CiliumNetworkPolicy
   metadata:
     name: edge-ingress
     namespace: coregateway
   spec:
     endpointSelector:
       matchExpressions:
         - {key: app, operator: In, values: [coregateway-api, web]}
     ingress:
       - fromEntities: [ingress]
       - fromEndpoints:                        # downstreams fetching JWKS
           - matchLabels:
               k8s:io.kubernetes.pod.namespace: coregateway
         toPorts:
           - ports: [{port: "8080", protocol: TCP}]
   ```

3. Database egress to Neon, by name rather than by address, on every pod that
   has an egress policy:

   ```yaml
   egress:
     - toEndpoints:
         - matchLabels:
             k8s:io.kubernetes.pod.namespace: kube-system
             k8s:k8s-app: kube-dns
       toPorts:
         - ports: [{port: "53", protocol: ANY}]
           rules:
             dns: [{matchPattern: "*"}]        # required for toFQDNs to learn addresses
     - toFQDNs:
         - matchPattern: "*.neon.tech"
       toPorts:
         - ports: [{port: "5432", protocol: TCP}]
   ```

Apply policies last, one at a time, and watch for drops with
`hubble observe -n coregateway --verdict DROPPED`.

**Verify**

```sh
kubectl -n coregateway get pods                    # all Running, 0 restarts after settling
kubectl -n coregateway get httproute core          # Accepted and ResolvedRefs True
curl -sI https://core.ejsadiarin.com | head -1     # 200
# Only /api reaches the gateway. /.well-known/jwks.json, /swagger and /health
# fall through to the web pod, so they are not published:
curl -s https://core.ejsadiarin.com/.well-known/jwks.json | head -c 15   # HTML, not JSON
# Browser: log in, open the budget page, check the cookie is Secure and HttpOnly
# Deny test from deploy/README.md section C: a debug pod curling corefinance directly must time out
```

---

## 16. Moving a Compose app: ntfy

The recipe for any Compose service, using ntfy as the worked case because
coreban depends on it.

1. **Inventory** from the compose file: image and tag, ports, bind mounts and
   named volumes (which hold state), environment, anything on the host it
   touches.
2. **Translate**: bind mount with state → claim on `longhorn`; config file →
   ConfigMap; secret environment → `.sops.yaml` Secret; Traefik labels →
   `HTTPRoute` on the internal Gateway.
3. **Stop, copy, start**: stop the Compose service so the data is quiet, copy
   it into the claim, start the pod.
4. **Cut over**: confirm on the new `lab` name, then remove the Compose
   service. Keep the old directory until a backup of the new volume exists.

ntfy has two bind mounts: `./cache` (message cache and auth database) and
`./etc` (`server.yml`).

```yaml
# apps/ntfy/ntfy.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ntfy
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ntfy-data
  namespace: ntfy
spec:
  accessModes: [ReadWriteOnce]
  resources: {requests: {storage: 2Gi}}      # longhorn by default
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ntfy
  namespace: ntfy
data:
  server.yml: |
    base-url: https://ntfy.lab.ejsadiarin.com
    cache-file: /var/cache/ntfy/cache.db
    auth-file: /var/cache/ntfy/user.db
    auth-default-access: deny-all
    behind-proxy: true
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ntfy
  namespace: ntfy
spec:
  replicas: 1
  strategy: {type: Recreate}                 # one writer on a ReadWriteOnce volume
  selector:
    matchLabels: {app: ntfy}
  template:
    metadata:
      labels: {app: ntfy}
    spec:
      containers:
        - name: ntfy
          image: binwiederhier/ntfy:v2.37.2
          args: [serve]
          ports: [{containerPort: 80}]
          volumeMounts:
            - {name: data, mountPath: /var/cache/ntfy}
            - {name: config, mountPath: /etc/ntfy, readOnly: true}
      volumes:
        - name: data
          persistentVolumeClaim: {claimName: ntfy-data}
        - name: config
          configMap: {name: ntfy}
---
apiVersion: v1
kind: Service
metadata:
  name: ntfy
  namespace: ntfy
spec:
  selector: {app: ntfy}
  ports: [{port: 80, targetPort: 80}]
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: ntfy
  namespace: ntfy
spec:
  parentRefs: [{name: internal, namespace: gateway, sectionName: https}]
  hostnames: [ntfy.lab.ejsadiarin.com]
  rules:
    - backendRefs: [{name: ntfy, port: 80}]
```

Merge your existing `etc/server.yml` into the ConfigMap rather than replacing
it; keep the file paths matching the mount.

Copy the data across:

```sh
# core-2
cd ~/services/ntfy && docker compose stop

# laptop: scale down, mount the claim in a helper pod, copy, scale up
kubectl -n ntfy scale deploy/ntfy --replicas=0
kubectl -n ntfy run copy --image=alpine:3.21 --restart=Never --overrides='
{"spec":{"containers":[{"name":"copy","image":"alpine:3.21","command":["sleep","3600"],
 "volumeMounts":[{"name":"d","mountPath":"/data"}]}],
 "volumes":[{"name":"d","persistentVolumeClaim":{"claimName":"ntfy-data"}}]}}'
ssh core-2 'tar -C ~/services/ntfy/cache -cf - .' \
  | kubectl -n ntfy exec -i copy -- tar -C /data -xf -
kubectl -n ntfy delete pod copy
kubectl -n ntfy scale deploy/ntfy --replicas=1
```

Changing `base-url` changes the server address subscribers use: re-point the
phone app at `https://ntfy.lab.ejsadiarin.com` (the phone needs Tailscale on
to receive notifications), and existing users and tokens
carry over with the copied `user.db`.

**Verify**

```sh
curl -s -H "Authorization: Bearer <token>" -d "hello from k3s" \
  https://ntfy.lab.ejsadiarin.com/coreban-test      # arrives on the phone
```

---

## 17. Observability

- **Hubble UI** at `hubble.lab.ejsadiarin.com` for live flows and policy
  verdicts. CLI: `cilium hubble port-forward &` then `hubble observe`.
- **kube-prometheus-stack** for metrics, dashboards and alerts.

`HelmRelease` values worth setting:

```yaml
prometheus:
  prometheusSpec:
    retention: 15d
    resources:
      requests: {memory: 1Gi}
    affinity:
      nodeAffinity:
        preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            preference:
              matchExpressions:
                - {key: lab.ejsadiarin.com/class, operator: In, values: [compute]}
    storageSpec:
      volumeClaimTemplate:
        spec:
          resources: {requests: {storage: 20Gi}}
    # Pick up ServiceMonitors from every namespace, not only this release's.
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false
grafana:
  persistence: {enabled: true, size: 2Gi}
# k3s runs these inside one process; the chart's defaults look for pods.
kubeProxy: {enabled: false}
kubeControllerManager:
  endpoints: [<CORE1_IP>]
kubeScheduler:
  endpoints: [<CORE1_IP>]
kubeEtcd:
  endpoints: [<CORE1_IP>]
  service: {port: 2381, targetPort: 2381}
```

Add routes for `grafana.lab.ejsadiarin.com` (Service
`kube-prometheus-stack-grafana:80`). Grafana has its own login; change the
default admin password through a sops Secret and `grafana.admin.existingSecret`.

Enable `serviceMonitor.enabled: true` in the Cilium, cert-manager, Longhorn
and CloudNativePG charts after this release is up (the CRD must exist first).

**Alerts to ntfy.** Alertmanager posts JSON; ntfy turns it into a readable
notification with its built-in template:

```yaml
alertmanager:
  config:
    route:
      receiver: ntfy
      group_by: [alertname, namespace]
      repeat_interval: 12h
    receivers:
      - name: ntfy
        webhook_configs:
          - url: http://ntfy.ntfy.svc.cluster.local/alerts?template=alertmanager
            http_config:
              authorization:
                type: Bearer
                credentials_file: /etc/alertmanager/secrets/ntfy-token/token
  alertmanagerSpec:
    secrets: [ntfy-token]
```

Confirm the template name against the ntfy docs for your version; if it is
missing, use a small bridge such as `ntfy-alertmanager` instead.

Uptime Kuma and Beszel on Compose keep working and are worth keeping: they
watch the cluster from outside it.

---

## 18. Backups and the restore drill

| What | How | Where | Schedule |
|---|---|---|---|
| Cluster state (etcd) | k3s snapshots | Local disk and `b2://<B2_CLUSTER_BUCKET>/etcd` | Every 6 h, keep 28 |
| Manifests and encrypted secrets | Git | GitHub `core-infra` | Every push |
| Longhorn volumes | `RecurringJob nightly-b2` | `…/longhorn` | Nightly, keep 14 |
| Immich database | CloudNativePG + Barman Cloud plugin | `…/cnpg/immich` | Continuous WAL, daily base |
| Immich media | Existing restic job on `core-2` | Existing restic bucket | As today |
| `coredb` | Neon's own history; periodic `pg_dump` from the laptop | Neon, local | Manual |
| Keys that unlock everything | Vaultwarden and paper | Off-cluster | On change |

**Kept outside the cluster, or nothing above can be restored:**

- the cluster age key
- the k3s server token and `config.yaml`
- the B2 application key
- the tunnel credentials JSON
- the restic repository password

Vaultwarden runs on Compose on `core-2`, so it does not depend on the cluster.
It does depend on `core-2`: the paper copy of the age key covers that case.

### Restore drill

Run this once before trusting the cluster with anything, and after every major
change. Total loss of both nodes:

1. Reinstall Debian, repeat section 3.
2. Restore etcd on `core-1`, which brings back every object including Flux:

   ```sh
   curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.36.6+k3s1' \
     INSTALL_K3S_SKIP_START=true sh -s - server
   # config.yaml and the server token restored from Vaultwarden
   sudo k3s server --cluster-reset \
     --cluster-reset-restore-path=<snapshot name from `k3s etcd-snapshot ls`> \
     --etcd-s3 …                                # same flags as config.yaml
   sudo systemctl start k3s
   ```

   Without a usable snapshot, do sections 4–8 instead: a fresh cluster, the
   `sops-age` Secret from the saved key, and `flux bootstrap` against the same
   repo rebuilds everything except volume contents.
3. Longhorn volumes: in the Longhorn UI, **Backup → Restore** each volume with
   its original name, then create the matching PV/PVC (the UI offers this).
   Do it before the app that owns the claim starts, or scale that app to zero.
4. Immich database: bootstrap a new CNPG cluster with `bootstrap.recovery`
   from the object store (see the Immich guide).
5. Rejoin `core-2`, remount the drives, check the static volumes bind.

A drill that is only read is not a drill. The cheap version: restore one
Longhorn volume to a new name and read a file from it, monthly.

---

## 19. Upgrades

### Charts and images: Renovate

Install the hosted Renovate GitHub app on `core-infra`. `renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "flux": {"managerFilePatterns": ["/\\.ya?ml$/"]},
  "kubernetes": {"managerFilePatterns": ["/^apps/.+\\.ya?ml$/"]},
  "packageRules": [
    {"matchUpdateTypes": ["major"], "dependencyDashboardApproval": true},
    {"matchPackageNames": ["cilium", "longhorn"], "groupName": "storage-and-network", "automerge": false}
  ]
}
```

Every bump is a pull request. Merge one component at a time and watch
`flux get helmreleases -A`. Longhorn supports upgrading one minor at a time
only; Cilium the same. Read both upgrade notes before merging.

Your own images are bumped by editing the `sha-` tag in `apps/coregateway/`
after running migrations (15.6).

### k3s: system-upgrade-controller

`infrastructure/configs/k3s-upgrade.yaml`:

```yaml
apiVersion: upgrade.cattle.io/v1
kind: Plan
metadata:
  name: server
  namespace: system-upgrade
spec:
  concurrency: 1
  cordon: true
  version: v1.36.6+k3s1
  serviceAccountName: system-upgrade
  nodeSelector:
    matchExpressions:
      - {key: node-role.kubernetes.io/control-plane, operator: In, values: ["true"]}
  upgrade:
    image: rancher/k3s-upgrade
---
apiVersion: upgrade.cattle.io/v1
kind: Plan
metadata:
  name: agent
  namespace: system-upgrade
spec:
  concurrency: 1
  cordon: true
  version: v1.36.6+k3s1
  serviceAccountName: system-upgrade
  nodeSelector:
    matchExpressions:
      - {key: node-role.kubernetes.io/control-plane, operator: DoesNotExist}
  prepare:
    image: rancher/k3s-upgrade
    args: [prepare, server]
  upgrade:
    image: rancher/k3s-upgrade
```

To upgrade, change `version` in both plans and push. Order for a minor bump:
check Cilium's compatibility table, upgrade Cilium if needed, then k3s.

### Debian

`unattended-upgrades` applies security updates. Reboots are manual, one node
at a time: `kubectl drain core-2 --ignore-daemonsets --delete-emptydir-data`,
reboot, `kubectl uncordon core-2`. Draining `core-1` takes the API down for the
reboot; running pods on `core-2` keep serving.

---

## 20. Later phases

**Third node and quorum.** Join the new machine as a server
(`server: https://<CORE1_IP>:6443` plus the server flags from section 4), then
convert `core-2` from agent to server the same way. After that: raise
`operator.replicas` to 2, point `k8sServiceHost` at an address that covers all
three, and consider 3 Longhorn replicas. Two servers is worse than one: etcd
needs a majority, so go from one straight to three.

**Signing-key rotation.** The PR-based rotation jobs are ready in
`deploy/sops-rotation-cronjob.yaml`. Follow `deploy/README.md` section B2 once
the platform has been stable for a few weeks.

**Login in front of open dashboards.** Cilium's Gateway API has no
forward-auth filter, so the Authentik-on-Traefik pattern does not carry over.
Put `oauth2-proxy` in front of Hubble UI and Longhorn UI, backed by Authentik,
and route to the proxy instead of the app.

**Logs.** Add Loki or VictoriaLogs with a node log collector when
`kubectl logs` stops being enough.

**Moving `coredb` off Neon.** CloudNativePG is already installed. Recreate the
per-service roles and schemas from each repo's `internal/db/bootstrap.sql`,
restore a `pg_dump`, and swap `DATABASE_URL`. The pooler-related notes in
`.env.example` stop applying; add a CNPG `Pooler` if you still want one.

**Migration Jobs.** Replace the manual step in 15.6 with a Job per service
that Flux runs before the Deployment. coreban already has a `migrate`
subcommand; the others need goose in their images.

**DNS records per app instead of a wildcard.** If you ever want unused names
to not resolve at all, replace the wildcard with external-dns, which creates
one record per `HTTPRoute`.

---

## 21. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Node stays `NotReady` after install | No CNI yet, or Cilium cannot reach the API | `cilium status`; `k8sServiceHost` must be the node IP, not `127.0.0.1` |
| `GatewayClass cilium` missing | CRDs were applied after Cilium started | `kubectl -n kube-system rollout restart deploy/cilium-operator ds/cilium` |
| Gateway `PROGRAMMED False`, no address | Address pool missing or exhausted | `kubectl get ciliumloadbalancerippool`, `kubectl -n gateway describe svc cilium-gateway-internal` |
| Connections to a Gateway hang | Missing `xt_TPROXY`/`xt_socket` modules or no `iptables` on the node | `lsmod \| grep TPROXY`; Cilium agent logs |
| No `lab` device appears on the tailnet | Operator OAuth scopes or tags wrong, or the annotation did not reach the Service | `kubectl -n tailscale logs deploy/operator`; `kubectl -n gateway get svc cilium-gateway-internal -o yaml \| grep tailscale` |
| `lab` device is online but connections hang | `socketLB.hostNamespaceOnly` is not set in Cilium | `cilium config view \| grep -i sock`; restart the Cilium agents after changing it |
| `*.lab` does not resolve away from home | Split DNS not set, or AdGuard unreachable over the tailnet | `tailscale dns status`; `dig @<core-2 tailnet IP> hubble.lab.ejsadiarin.com` |
| Slow or stalling transfers between pods | Cilium picked up `tailscale0` and its MTU | `cilium config view \| grep -E 'devices\|mtu'`; pin `devices` to the wired card |
| Certificate stuck `Issuing` | Token scope, or the self-check is resolving through AdGuard | `kubectl -n gateway describe challenge`; the `dns01RecursiveNameservers` values in section 9 |
| Public site returns Cloudflare 1033 or 502 | No healthy connector, or the Gateway has no matching route | `kubectl -n cloudflared logs deploy/cloudflared`; `kubectl -n coregateway describe httproute core` |
| Public site returns 404 from the Gateway | Namespace lacks the `public` label, or hostname mismatch | `kubectl get ns coregateway --show-labels` |
| Login works but the session does not stick | `ENV` is not exactly `production`, or `ALLOWED_ORIGINS` does not match the public origin | Pod env; browser cookie flags |
| Downstream pods crash-loop at boot | JWKS URL unreachable (gateway not ready, or a policy blocks it) | Pod logs; `hubble observe --verdict DROPPED -n coregateway` |
| Everything breaks after applying a policy | Gateway-delivered traffic needs `fromEntities: [ingress]` | Section 15.7 |
| Flux says `decryption failed` | File encrypted without the cluster recipient | `sops -d` works locally but not in cluster: re-encrypt with `sops updatekeys <file>` |
| Longhorn volume `Degraded` | One node down, or a disk below the 25 % floor | Longhorn UI → Node; `df -h /var/lib/longhorn` |
| Pod stuck `ContainerCreating` with a Longhorn volume | `iscsid` not running on that node | `systemctl status iscsid` |
