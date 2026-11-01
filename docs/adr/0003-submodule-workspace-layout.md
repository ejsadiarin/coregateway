# Downstream services are git submodules joined by a Go workspace

Each downstream service keeps its own repository and Go module; the gateway vendors them under `services/<name>` as submodules and a `go.work` file joins them into one build. This lets a single `go build ./...` and a single refactor cross the gateway/downstream boundary, while each service still builds, tests, and deploys on its own. We rejected a monorepo because these services ship independently, and rejected treating them as plain dependencies because their code changes in lockstep with the proxy.

**Consequences**: a clone without `--recurse-submodules` breaks every `go` command in the repository, and the root module never crosses the nested module boundary — so root-level test and lint targets do not cover downstream code.
